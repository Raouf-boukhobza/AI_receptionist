import { Module } from '@nestjs/common';
import { BullmqModule } from '../../../common/bullmq/bullmq.module';
import { BullModule } from '@nestjs/bullmq';
import { INBOUND_MESSAGES_QUEUE } from './queue/inbound-messages.queue';

@Module({
  imports: [
    BullmqModule,
    BullModule.registerQueue({
      name: INBOUND_MESSAGES_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
  ],
  controllers: [],
  providers: [],
})
export class MessagingModule {}
