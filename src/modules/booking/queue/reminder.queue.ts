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

  async removeJob(jobId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    } catch {
      // Ignored if job doesn't exist or already removed
    }
  }
}
