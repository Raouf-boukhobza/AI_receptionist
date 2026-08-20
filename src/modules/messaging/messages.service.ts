import { Injectable, Logger } from '@nestjs/common';
import { MessageDto, WhatsappWebhookDto } from './dtos/whatsAppWebhook.dto';
import { TenantService } from '../tenantModule/tenant.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { InboundMessagesQueue } from './queue/inbound-messages.queue';
import { tenantContextStorage } from '../../../common/tenant-context/tenant-context.storage';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly prismaService: PrismaService,
    private readonly inboundMessagesQueue: InboundMessagesQueue,
  ) {}

  async saveInboundMessage(payload: WhatsappWebhookDto) {
    if (!payload?.entry || !Array.isArray(payload.entry)) {
      this.logger.warn('Received webhook payload with no entries');
      return [];
    }

    const processedMessages: Array<{
      messageId?: string;
      conversationId: string;
      tenantId: string;
      waMessageId: string;
    }> = [];

    for (const entry of payload.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        continue;
      }

      for (const change of entry.changes) {
        const value = change.value;
        if (!value) {
          continue;
        }

        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) {
          this.logger.warn('Webhook change metadata is missing phone_number_id');
          continue;
        }

        const tenantId =
          await this.tenantService.getTenantIdByPhoneNumberId(phoneNumberId);
        if (!tenantId) {
          this.logger.warn(
            `No tenant found for phone_number_id: ${phoneNumberId}`,
          );
          continue;
        }

        const messages = value.messages;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          continue;
        }

        for (const message of messages) {
          try {
            const result = await this.saveSingleMessage(tenantId, message);
            if (result) {
              processedMessages.push(result);
            }
          } catch (error) {
            this.logger.error(
              `Failed to process inbound message ${message.id} for tenant ${tenantId}: ${(error as Error).message}`,
              (error as Error).stack,
            );
          }
        }
      }
    }

    return processedMessages;
  }

  private async saveSingleMessage(
    tenantId: string,
    message: MessageDto,
  ): Promise<{
    messageId?: string;
    conversationId: string;
    tenantId: string;
    waMessageId: string;
  } | null> {
    const fromPhoneNumber = message.from;
    if (!fromPhoneNumber) {
      this.logger.warn(
        `Message ${message.id} is missing 'from' phone number, skipping`,
      );
      return null;
    }

    const content = message.text?.body;
    if (!content) {
      this.logger.warn(
        `Skipping message ${message.id} with unsupported type "${message.type}" or missing text body`,
      );
      return null;
    }

    const waMessageId = message.id;

    return await this.prismaService.rawClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_tenant = '${tenantId}'`,
      );

      return tenantContextStorage.run({ tenantId, tx }, async () => {
        // 1. Idempotency check: check if this WhatsApp message ID has already been recorded
        if (waMessageId) {
          const existingMessage =
            await this.prismaService.db.messages.findFirst({
              where: {
                tenant_id: tenantId,
                wa_message_id: waMessageId,
              },
            });

          if (existingMessage) {
            this.logger.log(
              `Message with wa_message_id ${waMessageId} already exists for tenant ${tenantId}. Skipping duplicate.`,
            );
            return {
              messageId: existingMessage.id,
              conversationId: existingMessage.conversation_id,
              tenantId,
              waMessageId,
            };
          }
        }

        // 2. Find or create conversation for this client and tenant
        let conversation = await this.prismaService.db.conversations.findFirst({
          where: {
            tenant_id: tenantId,
            client_phone: fromPhoneNumber,
          },
          orderBy: {
            updated_at: 'desc',
          },
        });

        if (!conversation) {
          conversation = await this.prismaService.db.conversations.create({
            data: {
              tenant_id: tenantId,
              client_phone: fromPhoneNumber,
              status: 'ai_active',
            },
          });
        } else {
          await this.prismaService.db.conversations.update({
            where: { id: conversation.id },
            data: { updated_at: new Date() },
          });
        }

        // 3. Save the inbound message
        const createdMessage = await this.prismaService.db.messages.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversation.id,
            sender: 'client',
            content,
            status: 'received',
            wa_message_id: waMessageId,
          },
        });

        // 4. Enqueue BullMQ job for asynchronous AI processing
        await this.inboundMessagesQueue.addJob({
          tenantId,
          messageId : createdMessage.id
        });

        this.logger.log(
          `Successfully saved inbound message ${waMessageId} (id: ${createdMessage.id}) and queued AI job for tenant ${tenantId}`,
        );

        return {
          messageId: createdMessage.id,
          conversationId: conversation.id,
          tenantId,
          waMessageId,
        };
      });
    });
  }
}