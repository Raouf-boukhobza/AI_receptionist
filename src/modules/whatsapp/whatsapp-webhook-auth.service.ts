import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Verifies Meta webhook subscription handshakes and request signatures.
 * No DB access here — pure config + crypto so it stays fast and side-effect free.
 */
@Injectable()
export class WhatsappWebhookAuthService {
  private readonly logger = new Logger(WhatsappWebhookAuthService.name);

  constructor(private readonly configService: ConfigService) {}

  /** Token Meta must echo back during GET /webhook verification. */
  getVerifyToken(): string | undefined {
    return this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');
  }

  /** GET /webhook handshake: hub.mode=subscribe + hub.verify_token must match. */
  verifySubscribe(mode?: string, token?: string): boolean {
    const expected = this.getVerifyToken();
    if (!expected) {
      this.logger.warn(
        'WHATSAPP_VERIFY_TOKEN is not configured — rejecting subscribe handshake',
      );
      return false;
    }
    return mode === 'subscribe' && token === expected;
  }

  /**
   * POST /webhook authenticity: HMAC-SHA256 of the RAW body vs X-Hub-Signature-256.
   * If WHATSAPP_APP_SECRET is unset (local dev), verification is bypassed with a warning.
   */
  verifySignature(
    rawBody: Buffer | string | undefined,
    signatureHeader: string | undefined,
  ): boolean {
    const appSecret =
      this.configService.get<string>('WHATSAPP_APP_SECRET')?.trim();

    if (!appSecret) {
      this.logger.warn(
        'WHATSAPP_APP_SECRET is not configured — skipping signature verification (dev only)',
      );
      return true;
    }

    if (!rawBody || !signatureHeader) {
      return false;
    }

    const expectedHex = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    const receivedHex = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice('sha256='.length)
      : signatureHeader;

    const expectedBuf = Buffer.from(`sha256=${expectedHex}`, 'utf8');
    const receivedBuf = Buffer.from(
      receivedHex.includes('=')
        ? receivedHex
        : `sha256=${receivedHex}`,
      'utf8',
    );

    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  }
}
