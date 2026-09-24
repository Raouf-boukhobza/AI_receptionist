import { forwardRef, Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { ReminderQueue, reminderQueue } from './queue/reminder.queue';
import { ReminderProcessor } from './queue/reminder.processor';
import { MessagingModule } from '../messaging/messaging.module';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    BullModule.registerQueue({
      name: reminderQueue,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 * 7 },
      },
    }),
    // forwardRef: MessagingModule -> AgentModule -> BookingModule (cycle).
    forwardRef(() => MessagingModule),
    BullBoardModule.forFeature({
      name: reminderQueue,
      adapter: BullMQAdapter,
    }),
  ],
  providers: [BookingService, ReminderQueue, ReminderProcessor],
  exports: [BookingService, ReminderQueue],
})
export class BookingModule {}
