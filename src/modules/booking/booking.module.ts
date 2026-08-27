import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { ReminderQueue, reminderQueue } from './queue/reminder.queue';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: reminderQueue,
    }),
  ],
  providers: [BookingService, ReminderQueue],
  exports: [BookingService, ReminderQueue],
})
export class BookingModule {}
