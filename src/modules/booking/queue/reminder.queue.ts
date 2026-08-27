import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';

export const reminderQueue = 'REMINDER_QUEUE';

@Injectable()
export class ReminderQueue {
  constructor(
    @InjectQueue(reminderQueue) private readonly queue: Queue<string>,
  ) {}

  async addJob(bookingId: string , date : Date ) : Promise<Job> {
    return this.queue.add('send-reminder', bookingId, {
      delay : date.getTime() - new Date().getTime()
    });
  }
}
