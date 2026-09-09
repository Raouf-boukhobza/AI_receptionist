import { Injectable, Logger } from '@nestjs/common';
import {
  MessageDto,
  MessageEchoDto,
  WhatsappWebhookDto,
} from './dtos/whatsAppWebhook.dto';
import { TenantService } from '../tenantModule/tenant.service';
import { InboundMessagesQueue } from './queue/inbound-messages.queue';
import { TenantTransaction } from '../../../common/tenant-context/tenant-transaction';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantTransaction: TenantTransaction,
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

        // 1. Handle staff replies sent from WhatsApp Business mobile app (coexistence echoes)
        const messageEchoes = value.message_echoes;
        if (messageEchoes && Array.isArray(messageEchoes) && messageEchoes.length > 0) {
          for (const echo of messageEchoes) {
            try {
              const result = await this.saveSingleEcho(tenantId, echo);
              if (result) {
                processedMessages.push(result);
              }
            } catch (error) {
              this.logger.error(
                `Failed to process echo message ${echo.id} for tenant ${tenantId}: ${(error as Error).message}`,
                (error as Error).stack,
              );
            }
          }
        }

        // 2. Handle inbound messages from clients
        const messages = value.messages;
        if (messages && Array.isArray(messages) && messages.length > 0) {
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
    }

    return processedMessages;
  }

  /**
   * Saves staff message echoes sent directly from the WhatsApp Business mobile app.
   * Sets conversation status to 'human_active' and increments version.
   * Does NOT enqueue to outbound queue since the message was already sent from the phone.
   */
  private async saveSingleEcho(
    tenantId: string,
    echo: MessageEchoDto,
  ): Promise<{
    messageId?: string;
    conversationId: string;
    tenantId: string;
    waMessageId: string;
  } | null> {
    const toPhoneNumber = echo.to;
    if (!toPhoneNumber) {
      this.logger.warn(`Echo message ${echo.id} is missing 'to' phone number, skipping`);
      return null;
    }

    const content = echo.text?.body;
    if (!content) {
      this.logger.warn(
        `Skipping echo message ${echo.id} with unsupported type "${echo.type}" or missing text body`,
      );
      return null;
    }

    const waMessageId = echo.id;

    return await this.tenantTransaction.run(tenantId, async (tx) => {
      // 1. Idempotency check: check if this WhatsApp message ID has already been recorded
      if (waMessageId) {
        const existingMessage = await tx.messages.findFirst({
          where: {
            tenant_id: tenantId,
            wa_message_id: waMessageId,
          },
        });

        if (existingMessage) {
          this.logger.log(
            `Echo message with wa_message_id ${waMessageId} already exists for tenant ${tenantId}. Skipping duplicate.`,
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
      let conversation = await tx.conversations.findFirst({
        where: {
          tenant_id: tenantId,
          client_phone: toPhoneNumber,
        },
        orderBy: {
          updated_at: 'desc',
        },
      });

      if (!conversation) {
        conversation = await tx.conversations.create({
          data: {
            tenant_id: tenantId,
            client_phone: toPhoneNumber,
            status: 'human_active',
            version: 1,
          },
        });
      } else {
        conversation = await tx.conversations.update({
          where: { id: conversation.id },
          data: {
            status: 'human_active',
            version: { increment: 1 },
            updated_at: new Date(),
          },
        });
      }

      // 3. Save the echo message as an owner message with status 'sent'
      const createdMessage = await tx.messages.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversation.id,
          sender: 'owner',
          content,
          status: 'sent',
          wa_message_id: waMessageId,
        },
      });

      this.logger.log(
        `Saved WhatsApp Business mobile echo message ${waMessageId} (id: ${createdMessage.id}) and set conversation ${conversation.id} to human_active for tenant ${tenantId}`,
      );

      return {
        messageId: createdMessage.id,
        conversationId: conversation.id,
        tenantId,
        waMessageId,
      };
    });
  }

  /**
   * Saves client messages.
   * Only enqueues for AI processing if the conversation is in 'ai_active' status.
   * If the conversation is 'human_active' or 'needs_human', the message is saved for history
   * but the AI stays silent.
   */
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

    const result = await this.tenantTransaction.run(tenantId, async (tx) => {
      // 1. Idempotency check: check if this WhatsApp message ID has already been recorded
      if (waMessageId) {
        const existingMessage = await tx.messages.findFirst({
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
            shouldQueue: false,
          };
        }
      }

      // 2. Find or create conversation for this client and tenant
      let conversation = await tx.conversations.findFirst({
        where: {
          tenant_id: tenantId,
          client_phone: fromPhoneNumber,
        },
        orderBy: {
          updated_at: 'desc',
        },
      });

      if (!conversation) {
        conversation = await tx.conversations.create({
          data: {
            tenant_id: tenantId,
            client_phone: fromPhoneNumber,
            status: 'ai_active',
          },
        });
      } else {
        await tx.conversations.update({
          where: { id: conversation.id },
          data: { updated_at: new Date() },
        });
      }

      // 3. Save the inbound message
      const createdMessage = await tx.messages.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversation.id,
          sender: 'client',
          content,
          status: 'received',
          wa_message_id: waMessageId,
        },
      });

      // 4. Only queue AI processing if conversation is in 'ai_active' mode
      const shouldQueue = conversation.status === 'ai_active';

      return {
        messageId: createdMessage.id,
        conversationId: conversation.id,
        tenantId,
        waMessageId,
        shouldQueue,
        status: conversation.status,
      };
    });

    if (result.shouldQueue && result.messageId) {
      await this.inboundMessagesQueue.addJob({
        tenantId,
        messageId: result.messageId,
      });

      this.logger.log(
        `Successfully saved inbound message ${waMessageId} (id: ${result.messageId}) and queued AI job for tenant ${tenantId}`,
      );
    } else if (!result.shouldQueue) {
      this.logger.log(
        `Inbound message ${waMessageId} saved but AI not queued (conversation ${result.conversationId} status: ${result.status})`,
      );
    }

    return {
      messageId: result.messageId,
      conversationId: result.conversationId,
      tenantId,
      waMessageId: result.waMessageId,
    };
  }
}