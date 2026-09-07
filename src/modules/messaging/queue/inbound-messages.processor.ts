import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  INBOUND_MESSAGES_QUEUE,
  InboundMessagesJob,
} from './inbound-messages.queue';
import { AgentService } from '../../agent/agent.service';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';
import { Prisma } from '../../../../generated/prisma/client';
import { OutboundMessagesQueue } from './outbound-messages.queue';

@Processor(INBOUND_MESSAGES_QUEUE, { concurrency: 10 })
export class InboundMessagesProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundMessagesProcessor.name);
  constructor(
    private readonly agentService: AgentService,
    private readonly tenantTransaction: TenantTransaction,
    private readonly outboundQueue: OutboundMessagesQueue,
  ) {
    super();
  }

  async process(job: Job<InboundMessagesJob>) {
    const { tenantId, messageId } = job.data;

    this.logger.log(
      `Processing inbound message ${messageId} for tenant ${tenantId}`,
    );
    await this.tenantTransaction.run(tenantId, async (tx) => {
      await tx.messages.update({
        where: { id: messageId },
        data: { status: 'processing' },
      });
    });

    //case 1: reply to message already exist
    const state = await this.tenantTransaction.run(tenantId, async (tx) => {
      const inbound = await tx.messages.findFirstOrThrow({
        where: { id: messageId },
        include: { conversations: true },
      });
      const existingReply = await tx.messages.findFirst({
        where: { reply_to_message_id: inbound.id },
      });
      return { inbound, existingReply };
    });

    if (state.existingReply) {
      //skip the llm call
      this.logger.log(`Message ${messageId} already has a reply`);
      return this.outboundQueue.addJob({
        tenantId,
        messageId: state.existingReply.id,
      });
    }

    //case 2:reply doesn't exist
    const reply = await this.agentService.getResponse(
      state.inbound.content,
      tenantId,
      state.inbound.conversation_id,
      state.inbound.conversations.client_phone,
    );
    this.logger.log(reply);

    const replyRow = await this.tenantTransaction.run(tenantId, async (tx) => {
      try {
        const created = await tx.messages.create({
          data: {
            tenant_id: tenantId,
            conversation_id: state.inbound.conversation_id,
            sender: 'ai',
            status: 'pending_dispatch', // ← the outbox state
            reply_to_message_id: messageId, // ← Layer 3 unique guard
            content: reply,
          },
        });
        await tx.messages.update({
          where: {
            id: messageId,
          },
          data: {
            status: 'replied',
          },
        });
        return created;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return await tx.messages.findFirst({
            where: { reply_to_message_id: messageId },
          }); // another worker already committed the reply
        }
        throw e;
      }
    });
    if (replyRow) {
      await this.outboundQueue.addJob({
        tenantId,
        messageId: replyRow.id,
      });
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<InboundMessagesJob>) {
    this.logger.log(`🚀 Job ${job.id} started execution.`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<InboundMessagesJob>, result: any) {
    this.logger.log(`✅ Job ${job.id} completed successfully.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<InboundMessagesJob> | undefined, error: Error) {
    this.logger.error(
      `💥 Job ${job?.id} failed on attempt ${job?.attemptsMade}/${job?.opts?.attempts}: ${error.message}`,
      error.stack,
    );
  }
}
