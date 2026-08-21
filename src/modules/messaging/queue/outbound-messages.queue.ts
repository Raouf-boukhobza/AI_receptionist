import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const OUTBOUND_MESSAGES_QUEUE = 'outbound-messages';

export interface OutboundMessagesJob {
  tenantId: string;
  messageId: string;
}

@Injectable()
export class OutboundMessagesQueue {
  constructor(
    @InjectQueue(OUTBOUND_MESSAGES_QUEUE)
    private readonly queue: Queue<OutboundMessagesJob>,
  ) {}

  async addJob(data: OutboundMessagesJob) {
    return this.queue.add('process-oubound-message', data, {
      jobId: `outbound-${data.messageId}`,
    });
  }
}