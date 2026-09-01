import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { TenantTransaction } from '../../../../../common/tenant-context/tenant-transaction';
import { BookingService } from '../../../booking/booking.service';

const bookingSchema = z.object({
  service: z.string().describe('The name of the service to book'),
  date: z.string().describe('Date in YYYY-MM-DD format'),
  time: z.string().describe('Time in HH:mm format'),
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

      const result = await tenantTransaction.run(tenantId, async () => {
        return bookingService.createBooking({
          tenantId,
          clientPhone: phoneNumber,
          serviceName: service,
          date,
          time,
          doctorName,
        });
      });
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
