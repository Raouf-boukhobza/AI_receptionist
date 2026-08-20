import { forwardRef, Module } from '@nestjs/common';
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

@Module({
  imports: [
    BullmqModule,
    TenantModule,
    forwardRef(() => AgentModule),
    BullModule.registerQueue({
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
    }),
    BullBoardModule.forFeature({
      name: INBOUND_MESSAGES_QUEUE,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [MessagesController],
  providers: [InboundMessagesQueue, MessagesService],
  exports: [InboundMessagesQueue, MessagesService],
})
export class MessagingModule {}
