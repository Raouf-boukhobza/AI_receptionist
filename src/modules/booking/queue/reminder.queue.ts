import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';

export const reminderQueue = 'REMINDER_QUEUE';

/** Default template used for appointment reminders (Meta dashboard must approve it). */
export const REMINDER_TEMPLATE_NAME = 'appointment_reminder';
export const REMINDER_TEMPLATE_LANGUAGE = 'en';

export interface ReminderJob {
  bookingId: string;
  tenantId: string;
}

@Injectable()
export class ReminderQueue {
  constructor(
    @InjectQueue(reminderQueue) private readonly queue: Queue<ReminderJob>,
  ) {}

  async addJob(data: ReminderJob, date: Date): Promise<Job<ReminderJob>> {
    return this.queue.add('send-reminder', data, {
      delay: date.getTime() - new Date().getTime(),
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
