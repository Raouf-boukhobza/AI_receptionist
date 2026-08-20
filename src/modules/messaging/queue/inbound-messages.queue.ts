import {Queue} from "bullmq";
import {Injectable} from "@nestjs/common";
import {InjectQueue} from "@nestjs/bullmq";

export const INBOUND_MESSAGES_QUEUE ='inbound-messages';

export interface InboundMessagesJob  {
    tenantId: string;
    messageId : string
}

@Injectable()
export class InboundMessagesQueue {
    constructor(
        @InjectQueue(INBOUND_MESSAGES_QUEUE) private readonly queue: Queue<InboundMessagesJob>) {}

    async addJob(data: InboundMessagesJob) {
        return this.queue.add('process-inbound-message', data, {
          jobId: `inbound-${data.messageId}`,
        });
    }
}