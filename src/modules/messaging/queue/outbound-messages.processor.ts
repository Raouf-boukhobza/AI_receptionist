import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import {
  OUTBOUND_MESSAGES_QUEUE,
  OutboundMessagesJob,
} from './outbound-messages.queue';
import { WhatsappClient } from '../../whatsapp/whatsapp.client';
import { WhatsappSendError } from '../../whatsapp/whatsapp.errors';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';
import { OutboundSweeperService } from './outbound-sweeper.service';
import { REDIS_CLIENT } from '../../../../common/redis/redis.provider';
import Redis from 'ioredis';

@Processor(OUTBOUND_MESSAGES_QUEUE, { concurrency: 5 })
export class OutboundMessagesProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundMessagesProcessor.name);

  constructor(
    private readonly whatsappClient: WhatsappClient,
    private readonly tenantTransaction: TenantTransaction,
    private readonly sweeperService: OutboundSweeperService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<OutboundMessagesJob>): Promise<void> {
    if (job.name === 'sweep') {
      await this.sweeperService.runSweep();
      return;
    }

    const { tenantId, messageId, expectedVersion, resumeAi } = job.data;

    this.logger.log(`Processing outbound message ${messageId} for tenant ${tenantId}`);

    // Phase A: Claim
    const claimed = await this.claimMessage(tenantId, messageId);
    if (!claimed) {
      this.logger.log(
        `Outbound message ${messageId} skipped (already sent, dead, claimed, or suppressed)`,
      );
      return;
    }

    // Phase B: Send (outside DB transaction)
    // Template rows (reminders) go via sendTemplate — exempt from Meta's 24h
    // window. Everything else uses free-form text.
    let wamid: string;
    try {
      const template = parseTemplateFields(claimed.template_name, claimed.template_params);
      const result = template
        ? await this.whatsappClient.sendTemplate({
            tenantId,
            to: claimed.conversations.client_phone,
            templateName: template.name,
            languageCode: template.languageCode,
            bodyParams: template.bodyParams,
          })
        : await this.whatsappClient.sendText({
            tenantId,
            to: claimed.conversations.client_phone,
            body: claimed.content,
          });
      wamid = result.wamid;
    } catch (error: any) {
      const isRetryable = error instanceof WhatsappSendError ? error.retryable : true;
      const isLastAttempt = claimed.dispatch_attempts >= 3;
      const terminal = !isRetryable || isLastAttempt;
      const nextStatus = terminal ? 'dead' : 'dispatch_failed';
      const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 500);

      await this.tenantTransaction.run(tenantId, async (tx) => {
        await tx.messages.updateMany({
          where: { id: messageId, status: 'sending' },
          data: { status: nextStatus, last_error: errorMessage },
        });
      });

      if (terminal) {
        throw new UnrecoverableError(errorMessage);
      }
      throw error; // Triggers BullMQ backoff retry
    }

    // Phase C: Record & CAS Auto-Resume
    await this.recordSuccess(tenantId, messageId, wamid, claimed, expectedVersion, resumeAi);
  }

  private async claimMessage(tenantId: string, messageId: string) {
    return this.tenantTransaction.run(tenantId, async (tx) => {
      // 1. Atomic claim: strictly pending_dispatch or dispatch_failed with attempts < 3
      const updated = await tx.messages.updateMany({
        where: {
          id: messageId,
          status: { in: ['pending_dispatch', 'dispatch_failed'] },
          dispatch_attempts: { lt: 3 },
        },
        data: {
          status: 'sending',
          dispatch_attempts: { increment: 1 },
          dispatched_at: new Date(),
        },
      });

      if (updated.count === 0) {
        return null;
      }

      // 2. Fetch row, conversation state, and triggering message state
      const msg = await tx.messages.findUniqueOrThrow({
        where: { id: messageId },
        include: {
          conversations: {
            select: {
              id: true,
              client_phone: true,
              status: true,
              version: true,
            },
          },
          messages: {
            select: {
              status: true,
            },
          },
        },
      });

      // 3. AI Reply Suppression:
      // - In human_active: all AI replies (including holding) are suppressed.
      // - In needs_human: ONLY the holding reply for that escalation may send.
      // - In ai_active: normal AI replies may send.
      if (msg.sender === 'ai') {
        const convStatus = msg.conversations.status;
        const isHoldingReply = msg.messages?.status === 'escalated';

        const isAllowed =
          convStatus === 'ai_active' ||
          (convStatus === 'needs_human' && isHoldingReply);

        if (!isAllowed) {
          this.logger.log(
            `AI reply ${messageId} suppressed because conversation ${msg.conversation_id} is in "${convStatus}" (isHoldingReply: ${isHoldingReply})`,
          );
          await tx.messages.update({
            where: { id: messageId },
            data: {
              status: 'dead',
              last_error: `suppressed: conversation in ${convStatus}`,
            },
          });
          return null;
        }
      }

      // 4. Owner Reply Ordering: prevent newer owner replies from sending ahead of older ones
      if (msg.sender === 'owner') {
        const priorUnresolved = await tx.messages.findFirst({
          where: {
            conversation_id: msg.conversation_id,
            sender: 'owner',
            created_at: { lt: msg.created_at },
            status: { in: ['pending_dispatch', 'sending', 'dispatch_failed'] },
          },
        });

        if (priorUnresolved) {
          // Revert claim and attempt count so prior message can proceed first
          await tx.messages.update({
            where: { id: messageId },
            data: {
              status: 'pending_dispatch',
              dispatch_attempts: { decrement: 1 },
            },
          });
          this.logger.warn(
            `Owner reply ${messageId} deferred behind earlier unresolved reply ${priorUnresolved.id}`,
          );
          throw new Error('PRIOR_OWNER_REPLY_PENDING');
        }
      }

      return msg;
    });
  }

  private async recordSuccess(
    tenantId: string,
    messageId: string,
    wamid: string,
    claimed: {
      id: string;
      conversation_id: string;
      sender: string;
      dispatch_attempts: number;
    },
    expectedVersion?: number,
    resumeAi?: boolean,
  ) {
    await this.tenantTransaction.run(tenantId, async (tx) => {
      // 1. Mark sent and persist wamid
      await tx.messages.updateMany({
        where: { id: messageId, status: 'sending' },
        data: {
          status: 'sent',
          wa_message_id: wamid,
          last_error: null,
        },
      });

      // 2. Check early receipt cache in Redis
      try {
        let cachedReceipt: string | null = null;
        if (typeof this.redis.getdel === 'function') {
          cachedReceipt = await this.redis.getdel(`early_receipt:${wamid}`);
        } else {
          cachedReceipt = await this.redis.get(`early_receipt:${wamid}`);
          if (cachedReceipt) {
            await this.redis.del(`early_receipt:${wamid}`);
          }
        }

        if (cachedReceipt) {
          const receipt = JSON.parse(cachedReceipt);
          let targetStatus: 'delivered' | 'read' | 'undeliverable';
          if (receipt.status === 'delivered') {
            targetStatus = 'delivered';
          } else if (receipt.status === 'read') {
            targetStatus = 'read';
          } else {
            targetStatus = 'undeliverable';
          }
          await tx.messages.updateMany({
            where: { id: messageId },
            data: {
              status: targetStatus,
              ...(targetStatus === 'delivered' || targetStatus === 'read'
                ? {
                    delivered_at: receipt.delivered_at ? new Date(receipt.delivered_at) : new Date(),
                    last_error: null,
                  }
                : {
                    last_error: receipt.error ?? null,
                  }),
            },
          });
          this.logger.log(`Resolved early receipt from Redis for wamid ${wamid}`);
        }
      } catch (redisErr: any) {
        this.logger.warn(
          `Failed checking early receipt cache in Redis for ${wamid}: ${redisErr.message}`,
        );
      }

      // 3. Guarded Auto-Resume for owner replies
      if (claimed.sender === 'owner' && resumeAi && expectedVersion != null) {
        const pendingCount = await tx.messages.count({
          where: {
            conversation_id: claimed.conversation_id,
            sender: 'owner',
            status: { in: ['pending_dispatch', 'sending', 'dispatch_failed'] },
            id: { not: messageId },
          },
        });

        if (pendingCount === 0) {
          const convUpdate = await tx.conversations.updateMany({
            where: {
              id: claimed.conversation_id,
              status: 'human_active',
              version: expectedVersion,
            },
            data: {
              status: 'ai_active',
              version: { increment: 1 },
              updated_at: new Date(),
            },
          });

          if (convUpdate.count > 0) {
            this.logger.log(
              `Conversation ${claimed.conversation_id} auto-resumed to ai_active following owner reply ${messageId}`,
            );
          } else {
            this.logger.log(
              `Auto-resume skipped for conversation ${claimed.conversation_id}: version or status changed`,
            );
          }
        } else {
          this.logger.log(
            `Auto-resume deferred for conversation ${claimed.conversation_id}: ${pendingCount} other owner replies still pending`,
          );
        }
      }
    });
  }
}

export interface TemplateSend {
  name: string;
  languageCode?: string;
  bodyParams: string[];
}

/**
 * Reads template routing off a claimed outbox row. Returns null for plain-text
 * rows (template_name unset). Tolerates params stored as object or JSON string.
 */
export function parseTemplateFields(
  templateName: string | null | undefined,
  templateParams: unknown,
): TemplateSend | null {
  if (!templateName) {
    return null;
  }
  let parsed: { languageCode?: unknown; bodyParams?: unknown } = {};
  if (typeof templateParams === 'string' && templateParams.trim() !== '') {
    try {
      parsed = JSON.parse(templateParams) as typeof parsed;
    } catch {
      parsed = {};
    }
  } else if (templateParams && typeof templateParams === 'object') {
    parsed = templateParams as typeof parsed;
  }
  return {
    name: templateName,
    languageCode:
      typeof parsed.languageCode === 'string' && parsed.languageCode.trim() !== ''
        ? parsed.languageCode
        : undefined,
    bodyParams: Array.isArray(parsed.bodyParams)
      ? parsed.bodyParams.map((p) => String(p))
      : [],
  };
}
