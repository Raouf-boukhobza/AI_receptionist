import { Module } from '@nestjs/common';
import { BullmqModule } from '../../../common/bullmq/bullmq.module';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import {
  INBOUND_MESSAGES_QUEUE,
  InboundMessagesQueue,
} from './queue/inbound-messages.queue';
import { AgentModule } from '../agent/agent.module';
import { TenantModule } from '../tenantModule/tenant.module';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import {
  OUTBOUND_MESSAGES_QUEUE,
  OutboundMessagesQueue,
} from './queue/outbound-messages.queue';
import { InboundMessagesProcessor } from './queue/inbound-messages.processor';
import { OutboundMessagesProcessor } from './queue/outbound-messages.processor';
import { OutboundSweeperService } from './queue/outbound-sweeper.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullmqModule,
    TenantModule,
    AgentModule,
    WhatsappModule,
    BullModule.registerQueue(
      {
        name: INBOUND_MESSAGES_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: { age: 3600, count: 1000 }, // Keep last 1000 for 1 hr
          removeOnFail: { age: 86400 * 7 }, // Keep failed jobs for 7 days in DLQ
        },
      },
      {
        name: OUTBOUND_MESSAGES_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: { age: 3600, count: 1000 }, // Keep last 1000 for 1 hr
          removeOnFail: { age: 86400 * 7 }, // Keep failed jobs for 7 days in DLQ
        },
      },
    ),
    BullBoardModule.forFeature(
      {
        name: INBOUND_MESSAGES_QUEUE,
        adapter: BullMQAdapter,
      },
      {
        name: OUTBOUND_MESSAGES_QUEUE,
        adapter: BullMQAdapter,
      },
    ),
  ],
  controllers: [MessagesController, WhatsappWebhookController],
  providers: [
    InboundMessagesQueue,
    MessagesService,
    OutboundMessagesQueue,
    InboundMessagesProcessor,
    OutboundMessagesProcessor,
    OutboundSweeperService,
  ],
  exports: [OutboundMessagesQueue, OutboundSweeperService],
})
export class MessagingModule {}
