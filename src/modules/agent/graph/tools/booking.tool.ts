import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { TenantTransaction } from '../../../../../common/tenant-context/tenant-transaction';
import { day_of_week } from '../../../../../generated/prisma/client';

interface BookingRow {
  doctor_id: string;
  start_time: Date;
  end_time: Date;
}

interface CandidateDoctor {
  doctor_id: string;
  doctorName: string;
}

interface DoctorWorkingHours {
  start_time: string;
  end_time: string;
}

const DAYS_OF_WEEK: day_of_week[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

const bookingSchema = z.object({
  service: z.string().describe('The name of the service to book'),
  date: z.string().describe('Date in YYYY-MM-DD format'),
  time: z.string().describe('Time in HH:mm format'),
  doctorName: z
    .string()
    .optional()
    .describe('Doctor name if the client asked for a specific doctor'),
});

export function createBookingTool(tenantTransaction: TenantTransaction) {
  return tool(
    async ({ service, date, time, doctorName }, config) => {
      const tenantId = config.configurable?.tenantId;
      const phoneNumber = config.configurable?.phoneNumber;
      if (!tenantId || !phoneNumber) {
        throw new Error('Tenant context or phone number missing from tool execution');
      }

      const cleanDate = date.trim();
      const cleanTime = normalizeTime(time);

      return tenantTransaction.run(tenantId, async (tx) => {
        // 1. Resolve service
        const serviceRow = await tx.services.findFirst({
          where: { name: { equals: service.trim(), mode: 'insensitive' } },
        });
        if (!serviceRow) {
          return `Service "${service}" not found.`;
        }

        const startTime = new Date(`${cleanDate}T${cleanTime}:00`);
        const endTime = new Date(
          startTime.getTime() + serviceRow.duration_minutes * 60000,
        );
        const endTimeStr = formatTime(endTime);

        // 2. Find candidate doctors offering this service (or specific doctor)
        const doctorLinks = await tx.doctor_services.findMany({
          where: {
            service_id: serviceRow.id,
            ...(doctorName
              ? { doctor: { name: { equals: doctorName.trim(), mode: 'insensitive' } } }
              : {}),
          },
          include: { doctors: true },
        });

        if (doctorLinks.length === 0) {
          return doctorName
            ? `Doctor "${doctorName}" does not offer "${service}".`
            : `No doctor available for "${service}".`;
        }

        const candidates: CandidateDoctor[] = doctorLinks.map((dl) => ({
          doctor_id: dl.doctor_id,
          doctorName: dl.doctors.name,
        }));
        const doctorIds = candidates.map((c) => c.doctor_id);

        // 3. Resolve day of week for requested date and next day
        const requestedDayOfWeek = getDayOfWeek(cleanDate);
        const nextDayStr = getNextDayStr(cleanDate);
        const nextDayOfWeek = getDayOfWeek(nextDayStr);

        // 4. Fetch working hours for all candidate doctors on requested and next day
        const doctorHoursRows = await tx.doctor_hours.findMany({
          where: {
            doctor_id: { in: doctorIds },
            day: { in: [requestedDayOfWeek, nextDayOfWeek] },
          },
        });

        const hoursMap = new Map<string, DoctorWorkingHours>();
        for (const dh of doctorHoursRows) {
          hoursMap.set(`${dh.doctor_id}:${dh.day}`, {
            start_time: dh.start_time,
            end_time: dh.end_time,
          });
        }

        // 5. Batch-fetch existing non-cancelled bookings for candidates
        const dayStart = new Date(`${cleanDate}T00:00:00`);
        const nextDayEnd = new Date(`${nextDayStr}T23:59:59`);

        const existingBookings = await tx.$queryRaw<BookingRow[]>`
          SELECT doctor_id, start_time, end_time
          FROM bookings
          WHERE doctor_id = ANY(${doctorIds}::uuid[])
            AND start_time >= ${dayStart}
            AND start_time < ${nextDayEnd}
            AND status != 'cancelled'::booking_status
        `;

        const bookingsByDoctor = new Map<string, BookingRow[]>();
        for (const b of existingBookings) {
          const list = bookingsByDoctor.get(b.doctor_id) ?? [];
          list.push(b);
          bookingsByDoctor.set(b.doctor_id, list);
        }

        // 6. First: validate which doctors are actually working at requested time
        const workingCandidates = candidates.filter((c) => {
          const dh = hoursMap.get(`${c.doctor_id}:${requestedDayOfWeek}`);
          return isWithinWorkingHours(dh, cleanTime, endTimeStr);
        });

        // 7. Second: among working doctors, find one with no booking conflict
        const availableDoctor = workingCandidates.find((c) => {
          const doctorBookings = bookingsByDoctor.get(c.doctor_id) ?? [];
          return !hasConflict(doctorBookings, startTime, endTime);
        });

        if (availableDoctor) {
          const booking = await tx.bookings.create({
            data: {
              tenant_id: tenantId,
              doctor_id: availableDoctor.doctor_id,
              service_id: serviceRow.id,
              start_time: startTime,
              end_time: endTime,
              client_phone: phoneNumber,
            },
          });
          return `Booking confirmed with Dr. ${availableDoctor.doctorName} on ${cleanDate} at ${cleanTime}. Booking id: ${booking.id}`;
        }

        // 8. Slot not available (outside working hours or conflict) -> generate valid alternatives
        const alternatives: string[] = [];

        // 8a. Same day alternatives within doctor working hours
        for (const c of candidates) {
          const dh = hoursMap.get(`${c.doctor_id}:${requestedDayOfWeek}`);
          if (dh) {
            const doctorBookings = bookingsByDoctor.get(c.doctor_id) ?? [];
            const sameDaySlots = findAvailableSlots(
              doctorBookings,
              cleanDate,
              dh.start_time,
              dh.end_time,
              serviceRow.duration_minutes,
            );
            if (sameDaySlots.length > 0) {
              alternatives.push(
                `Dr. ${c.doctorName}: ${sameDaySlots.slice(0, 3).join(', ')} (${cleanDate})`,
              );
            }
          }
        }

        // 8b. Next day alternatives within doctor working hours
        for (const c of candidates) {
          const dh = hoursMap.get(`${c.doctor_id}:${nextDayOfWeek}`);
          if (dh) {
            const doctorBookings = bookingsByDoctor.get(c.doctor_id) ?? [];
            const nextDaySlots = findAvailableSlots(
              doctorBookings,
              nextDayStr,
              dh.start_time,
              dh.end_time,
              serviceRow.duration_minutes,
            );
            if (nextDaySlots.length > 0) {
              alternatives.push(
                `Dr. ${c.doctorName}: ${nextDaySlots.slice(0, 3).join(', ')} (${nextDayStr})`,
              );
            }
          }
        }

        if (workingCandidates.length === 0) {
          if (alternatives.length === 0) {
            return `No working hours or availability found for "${service}" on ${cleanDate} or ${nextDayStr}.`;
          }
          return `The requested time (${cleanTime} on ${cleanDate}) is outside working hours. Available alternatives:\n${alternatives.join('\n')}`;
        }

        if (alternatives.length === 0) {
          return `No availability found for "${service}" on ${cleanDate} or ${nextDayStr}.`;
        }

        return `Requested slot (${cleanTime} on ${cleanDate}) is already booked. Available alternatives:\n${alternatives.join('\n')}`;
      });
    },
    {
      name: 'create_booking',
      description:
        'Book an appointment. Validates doctor working hours and booking conflicts, and suggests alternative available slots if the requested slot is taken or outside working hours.',
      schema: bookingSchema,
    },
  );
}

// ─── Pure helpers (no DB calls) ───────────────────────────────────────────────

function getDayOfWeek(dateStr: string): day_of_week {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return DAYS_OF_WEEK[date.getDay()];
}

function getNextDayStr(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTime(timeStr: string): string {
  const parts = timeStr.trim().split(':');
  if (parts.length === 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return timeStr.trim();
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function isWithinWorkingHours(
  workingHours: DoctorWorkingHours | undefined,
  startTimeStr: string,
  endTimeStr: string,
): boolean {
  if (!workingHours) return false;
  return (
    startTimeStr >= workingHours.start_time &&
    endTimeStr <= workingHours.end_time
  );
}

function hasConflict(
  bookings: BookingRow[],
  start: Date,
  end: Date,
): boolean {
  return bookings.some(
    (b) => b.start_time < end && b.end_time > start,
  );
}

function findAvailableSlots(
  bookings: BookingRow[],
  date: string,
  workingStart: string,
  workingEnd: string,
  durationMinutes: number,
): string[] {
  const durationMs = durationMinutes * 60000;
  const stepMin = 30;
  const possibleSlots = generateTimeSlots(
    workingStart,
    workingEnd,
    stepMin,
    durationMinutes,
  );

  const available: string[] = [];
  for (const t of possibleSlots) {
    const slotStart = new Date(`${date}T${t}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMs);
    if (!hasConflict(bookings, slotStart, slotEnd)) {
      available.push(t);
    }
  }
  return available;
}

function generateTimeSlots(
  start: string,
  end: string,
  stepMin: number,
  durationMin: number,
): string[] {
  const slots: string[] = [];
  let [h, m] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const endTotalMinutes = endH * 60 + endM;

  while (true) {
    const currentTotalMinutes = h * 60 + m;
    if (currentTotalMinutes + durationMin > endTotalMinutes) {
      break;
    }
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += stepMin;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }
  return slots;
}