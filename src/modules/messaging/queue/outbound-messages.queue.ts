import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const OUTBOUND_MESSAGES_QUEUE = 'outbound-messages';

export interface OutboundMessagesJob {
  tenantId: string;
  messageId: string;
  expectedVersion?: number;
  resumeAi?: boolean;
}

@Injectable()
export class OutboundMessagesQueue implements OnModuleInit {
  private readonly logger = new Logger(OutboundMessagesQueue.name);

  constructor(
    @InjectQueue(OUTBOUND_MESSAGES_QUEUE)
    private readonly queue: Queue<OutboundMessagesJob>,
  ) {}

  async onModuleInit() {
    /*try {
      if (typeof this.queue.upsertJobScheduler === 'function') {
        await this.queue.upsertJobScheduler(
          'outbound-sweep',
          { every: 60_000 },
          { name: 'sweep', data: { tenantId: '', messageId: '' } },
        );
        this.logger.log('Outbound message recovery sweeper scheduled (every 60s)');
      }
    } catch (error: any) {
      this.logger.warn(`Could not register job scheduler: ${error?.message || error}`);
    }*/
  }

  async addJob(data: OutboundMessagesJob) {
    return this.queue.add('send', data, {
      jobId: data.messageId,
    });
  }

  async requeue(data: OutboundMessagesJob) {
    try {
      const job = await this.queue.getJob(data.messageId);
      if (job) {
        const state = await job.getState();
        if (['waiting', 'delayed', 'active', 'prioritized'].includes(state)) {
          return;
        }
        await job.remove();
      }
    } catch (err: any) {
      this.logger.warn(`Failed to inspect/remove existing job for ${data.messageId}: ${err.message}`);
    }
    return this.addJob(data);
  }
}