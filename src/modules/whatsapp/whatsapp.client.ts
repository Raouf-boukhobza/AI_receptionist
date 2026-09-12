import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsappSendError } from './whatsapp.errors';

export interface SendTextParams {
  tenantId: string;
  to: string;
  body: string;
}

export interface SendTextResult {
  wamid: string;
}

@Injectable()
export class WhatsappClient {
  private readonly logger = new Logger(WhatsappClient.name);
  private readonly graphVersion: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');
  }

  async sendText(params: { tenantId: string; to: string; body: string }): Promise<SendTextResult> {
    const tenant = await this.prismaService.rawClient.tenants.findUnique({
      where: { id: params.tenantId },
      select: { phone_number_id: true, access_token: true },
    });

    if (!tenant || !tenant.phone_number_id || !tenant.access_token) {
      this.logger.error(`Tenant ${params.tenantId} is missing WhatsApp credentials`);
      throw new WhatsappSendError(
        'NO_CREDENTIALS',
        false,
        `Tenant ${params.tenantId} is missing WhatsApp credentials`,
      );
    }

    const { phone_number_id, access_token } = tenant;
    const cleanTo = params.to.replace(/\D/g, '');
    const url = `https://graph.facebook.com/${this.graphVersion}/${phone_number_id}/messages`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
          type: 'text',
          text: { body: params.body },
        }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const metaError = data?.error;
        const code = metaError?.code ? String(metaError.code) : String(response.status);
        const fbtraceId = metaError?.fbtrace_id;
        const message = metaError?.message || `Meta API responded with HTTP ${response.status}`;

        this.logger.error(
          `WhatsApp send failed for tenant ${params.tenantId}, phone_number_id: ${phone_number_id}. Code: ${code}, fbtrace_id: ${fbtraceId}`,
        );

        const retryable = this.isRetryable(response.status, metaError?.code);

        throw new WhatsappSendError(
          code,
          retryable,
          `Meta error (${code}): ${message}`,
          response.status,
          fbtraceId,
        );
      }

      const wamid = data?.messages?.[0]?.id;
      if (!wamid) {
        throw new WhatsappSendError('INVALID_RESPONSE', false, 'Missing message ID in Meta response');
      }

      this.logger.log(
        `WhatsApp message sent successfully. wamid: ${wamid} for tenant ${params.tenantId}`,
      );
      return { wamid };
    } catch (err: any) {
      if (err instanceof WhatsappSendError) {
        throw err;
      }
      if (err?.name === 'AbortError') {
        throw new WhatsappSendError('TIMEOUT', true, 'Request to Meta Graph API timed out after 10s');
      }
      throw new WhatsappSendError(
        'NETWORK_ERROR',
        true,
        `Network error sending WhatsApp message: ${err?.message || String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private isRetryable(httpStatus: number, metaCode?: number): boolean {
    if (httpStatus >= 500) {
      return true;
    }
    if (httpStatus === 429 || httpStatus === 408) {
      return true; // Rate limited / timeout: always retry regardless of Meta code
    }
    if (metaCode === 4 || metaCode === 80007 || metaCode === 130429) {
      return true; // Rate limits
    }
    if (metaCode === 190 || metaCode === 131026 || metaCode === 131047 || metaCode === 100) {
      return false; // Auth / Invalid recipient / 24h window closed / Bad request
    }
    if (httpStatus >= 400 && httpStatus < 500) {
      return false;
    }
    return false;
  }
}
