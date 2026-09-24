import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  REMINDER_TEMPLATE_LANGUAGE,
  REMINDER_TEMPLATE_NAME,
  ReminderJob,
  reminderQueue,
} from './reminder.queue';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from '../../messaging/queue/outbound-messages.queue';

@Processor(reminderQueue, { concurrency: 5 })
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private readonly tenantTransaction: TenantTransaction,
    @Inject(forwardRef(() => OutboundMessagesQueue))
    private readonly outboundMessagesQueue: OutboundMessagesQueue,
  ) {
    super();
  }

  async process(job: Job<ReminderJob>): Promise<void> {
    const { bookingId, tenantId } = job.data ?? ({} as ReminderJob);
    if (!bookingId || !tenantId) {
      this.logger.warn(`Reminder job ${job.id} missing bookingId/tenantId, skipping`);
      return;
    }

    const outcome = await this.tenantTransaction.run(tenantId, async (tx) => {
      const booking = await tx.bookings.findUnique({
        where: { id: bookingId },
        include: {
          doctors: { select: { name: true } },
          services: { select: { name: true } },
        },
      });

      if (!booking) {
        return { action: 'skip' as const, reason: 'booking not found' };
      }
      if (booking.status !== 'confirmed') {
        return { action: 'skip' as const, reason: `booking status is ${booking.status}` };
      }
      if (booking.start_time.getTime() <= Date.now()) {
        return { action: 'skip' as const, reason: 'appointment already passed' };
      }

      if (
        booking.reminder_24h_job_id !== job.id &&
        booking.reminder_1h_job_id !== job.id
      ) {
        return { action: 'skip' as const, reason: 'superseded by newer reminder job' };
      }

      let conversation = await tx.conversations.findFirst({
        where: { tenant_id: tenantId, client_phone: booking.client_phone },
        orderBy: { updated_at: 'desc' },
      });
      if (!conversation) {
        conversation = await tx.conversations.create({
          data: {
            tenant_id: tenantId,
            client_phone: booking.client_phone,
            status: 'ai_active',
          },
        });
      }

      const { content, bodyParams } = renderReminder(booking);

      const created = await tx.messages.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversation.id,
          sender: 'system',
          content,
          status: 'pending_dispatch',
          template_name: REMINDER_TEMPLATE_NAME,
          template_params: {
            languageCode: REMINDER_TEMPLATE_LANGUAGE,
            bodyParams,
          },
        },
      });
      return { action: 'send' as const, messageId: created.id };
    });

    if (outcome.action === 'skip') {
      this.logger.log(
        `Reminder job ${job.id} for booking ${bookingId} skipped (${outcome.reason})`,
      );
      return;
    }

    await this.outboundMessagesQueue.addJob({ tenantId, messageId: outcome.messageId });
    this.logger.log(
      `Reminder for booking ${bookingId} enqueued as message ${outcome.messageId}`,
    );
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function renderReminder(booking: {
  start_time: Date;
  doctors?: { name: string } | null;
  services?: { name: string } | null;
}): { content: string; bodyParams: string[] } {
  const start = booking.start_time;
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const service = booking.services?.name ?? 'your appointment';
  const doctor = booking.doctors?.name ?? '';
  const content =
    `Reminder: you have ${service}` +
    (doctor ? ` with ${doctor}` : '') +
    ` on ${date} at ${time}. Reply to reschedule or cancel.`;
  return { content, bodyParams: [service, date, time] };
}
