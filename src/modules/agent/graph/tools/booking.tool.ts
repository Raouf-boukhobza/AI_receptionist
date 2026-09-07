import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { TenantTransaction } from '../../../../../common/tenant-context/tenant-transaction';
import { BookingService } from '../../../booking/booking.service';

const bookingSchema = z.object({
  service: z.string().describe('The name of the service to book'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .describe('Date in YYYY-MM-DD format'),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm')
    .describe('Time in HH:mm format'),
  doctorName: z
    .string()
    .optional()
    .describe('Doctor name if the client asked for a specific doctor'),
});

export function createBookingTool(
  bookingService: BookingService,
  tenantTransaction: TenantTransaction,
) {
  return tool(
    async ({ service, date, time, doctorName }, config) => {
      const tenantId = config.configurable?.tenantId;
      const phoneNumber = config.configurable?.phoneNumber;
      if (!tenantId || !phoneNumber) {
        throw new Error(
          'Tenant context or phone number missing from tool execution',
        );
      }

      const result = await tenantTransaction.run(tenantId, async (tx) => {
        if (config.configurable?.conversationId) {
          const conv = await tx.conversations.findUnique({
            where: { id: config.configurable.conversationId },
            select: { status: true },
          });
          if (conv && conv.status !== 'ai_active') {
            return {
              status: 'HUMAN_TAKEOVER',
              message:
                'Conversation is currently in human takeover mode. Appointment booking was skipped.',
            } as any;
          }
        }

        return bookingService.createBooking({
          tenantId,
          clientPhone: phoneNumber,
          serviceName: service,
          date,
          time,
          doctorName,
        });
      });

      if (result.status === 'HUMAN_TAKEOVER') {
        return result.message;
      }
      if (result.status === 'CONFIRMED') {
        await bookingService.createReminders(
            tenantId,
            new Date(`${result.date}T${result.time}:00`),
            result.bookingId
        )
      }

      switch (result.status) {
        case 'CONFIRMED':
          return `Booking confirmed with Dr. ${result.doctorName} on ${result.date} at ${result.time}. Booking id: ${result.bookingId}`;
        case 'SERVICE_NOT_FOUND':
        case 'DOCTOR_NOT_AVAILABLE':
          return result.message;
        case 'UNAVAILABLE': {
          if (result.alternatives.length === 0) {
            return result.reason === 'OUTSIDE_HOURS'
              ? `No working hours or availability found for "${service}" on ${result.date} or ${result.nextDay}.`
              : `No availability found for "${service}" on ${result.date} or ${result.nextDay}.`;
          }
          const prefix =
            result.reason === 'OUTSIDE_HOURS'
              ? `The requested time (${result.time} on ${result.date}) is outside working hours.`
              : `Requested slot (${result.time} on ${result.date}) is already booked.`;
          return `${prefix} Available alternatives:\n${result.alternatives.join('\n')}`;
        }
      }
    },
    {
      name: 'create_booking',
      description:
        'Book an appointment. Validates doctor working hours and booking conflicts, and suggests alternative available slots if the requested slot is taken or outside working hours.',
      schema: bookingSchema,
    },
  );
}

const updateBookingSchema = z.object({
  bookingId: z
    .string()
    .optional()
    .describe('The ID of the booking to update, if specifically mentioned'),
  service: z
    .string()
    .optional()
    .describe('The new service name if changing the booked service'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .describe('New date in YYYY-MM-DD format'),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm')
    .describe('New time in HH:mm format'),
  doctorName: z
    .string()
    .optional()
    .describe('Doctor name if the client asked for a specific doctor'),
});

export function createUpdateBookingTool(
  bookingService: BookingService,
  tenantTransaction: TenantTransaction,
) {
  return tool(
    async ({ bookingId, service, date, time, doctorName }, config) => {
      const tenantId = config.configurable?.tenantId;
      const phoneNumber = config.configurable?.phoneNumber;
      if (!tenantId || !phoneNumber) {
        throw new Error(
          'Tenant context or phone number missing from tool execution',
        );
      }

      const result = await tenantTransaction.run(tenantId, async () => {
        return bookingService.updateBooking({
          tenantId,
          clientPhone: phoneNumber,
          bookingId,
          serviceName: service,
          date,
          time,
          doctorName,
        });
      });

      if (result.status === 'UPDATED') {
        if (result.oldReminder24hJobId) {
          await bookingService.cancelReminder(result.oldReminder24hJobId);
        }
        if (result.oldReminder1hJobId) {
          await bookingService.cancelReminder(result.oldReminder1hJobId);
        }
        await bookingService.createReminders(
          tenantId,
          new Date(`${result.date}T${result.time}:00`),
          result.bookingId,
        );
      }

      switch (result.status) {
        case 'UPDATED':
          return `Booking updated successfully with Dr. ${result.doctorName} for ${result.serviceName} on ${result.date} at ${result.time}. Booking id: ${result.bookingId}`;
        case 'BOOKING_NOT_FOUND':
        case 'SERVICE_NOT_FOUND':
        case 'DOCTOR_NOT_AVAILABLE':
          return result.message;
        case 'UNAVAILABLE': {
          const serviceLabel =
            result.serviceName || service || 'the requested service';
          if (result.alternatives.length === 0) {
            return result.reason === 'OUTSIDE_HOURS'
              ? `No working hours or availability found for "${serviceLabel}" on ${result.date} or ${result.nextDay}.`
              : `No availability found for "${serviceLabel}" on ${result.date} or ${result.nextDay}.`;
          }
          const prefix =
            result.reason === 'OUTSIDE_HOURS'
              ? `The requested time (${result.time} on ${result.date}) is outside working hours.`
              : `Requested slot (${result.time} on ${result.date}) is already booked.`;
          return `${prefix} Available alternatives:\n${result.alternatives.join('\n')}`;
        }
      }
    },
    {
      name: 'update_booking',
      description:
        'Update or reschedule an existing appointment to a new date, time, service, or doctor. Validates doctor working hours and conflicts, and suggests alternatives if requested slot is unavailable.',
      schema: updateBookingSchema,
    },
  );
}

const cancelBookingSchema = z.object({
  bookingId: z
    .string()
    .optional()
    .describe('The specific booking ID to cancel, if provided by the client'),
});

export function createCancelBookingTool(
  bookingService: BookingService,
  tenantTransaction: TenantTransaction,
) {
  return tool(
    async ({ bookingId }, config) => {
      const tenantId = config.configurable?.tenantId;
      const phoneNumber = config.configurable?.phoneNumber;
      if (!tenantId || !phoneNumber) {
        throw new Error(
          'Tenant context or phone number missing from tool execution',
        );
      }

      const result = await tenantTransaction.run(tenantId, async () => {
        return bookingService.cancelBooking({
          tenantId,
          clientPhone: phoneNumber,
          bookingId,
        });
      });

      if (result.status === 'CANCELLED') {
        if (result.reminder24hJobId) {
          await bookingService.cancelReminder(result.reminder24hJobId);
        }
        if (result.reminder1hJobId) {
          await bookingService.cancelReminder(result.reminder1hJobId);
        }
      }

      switch (result.status) {
        case 'CANCELLED':
          return `Your appointment with Dr. ${result.doctorName} for ${result.serviceName} on ${result.date} at ${result.time} has been cancelled successfully. Booking id: ${result.bookingId}`;
        case 'BOOKING_NOT_FOUND':
          return result.message;
      }
    },
    {
      name: 'cancel_booking',
      description:
        'Cancel an existing appointment. Looks up the active appointment by phone number or by booking ID, marks it as cancelled, and removes scheduled reminders.',
      schema: cancelBookingSchema,
    },
  );
}


