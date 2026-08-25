import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  BookingRow,
  CandidateDoctor,
  DoctorWorkingHours,
  getDayOfWeek,
  getNextDayStr,
  normalizeTime,
  formatTime,
  isWithinWorkingHours,
  hasConflict,
  findAvailableSlots,
} from './utils/booking-slots.util';

export interface CreateBookingParams {
  tenantId: string;
  clientPhone: string;
  serviceName: string;
  date: string;
  time: string;
  doctorName?: string;
}

export type BookingResult =
  | {
      status: 'CONFIRMED';
      bookingId: string;
      doctorName: string;
      date: string;
      time: string;
    }
  | {
      status: 'SERVICE_NOT_FOUND';
      message: string;
    }
  | {
      status: 'DOCTOR_NOT_AVAILABLE';
      message: string;
    }
  | {
      status: 'UNAVAILABLE';
      reason: 'OUTSIDE_HOURS' | 'ALREADY_BOOKED';
      alternatives: string[];
      date: string;
      time: string;
      nextDay: string;
    };

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  async createBooking(params: CreateBookingParams): Promise<BookingResult> {
    const { tenantId, clientPhone, serviceName, date, time, doctorName } =
      params;
    const cleanDate = date.trim();
    const cleanTime = normalizeTime(time);

    // 1. Resolve service
    const serviceRow = await this.prisma.db.services.findFirst({
      where: { name: { equals: serviceName.trim(), mode: 'insensitive' } },
    });
    if (!serviceRow) {
      return {
        status: 'SERVICE_NOT_FOUND',
        message: `Service "${serviceName}" not found.`,
      };
    }

    const startTime = new Date(`${cleanDate}T${cleanTime}:00`);
    const endTime = new Date(
      startTime.getTime() + serviceRow.duration_minutes * 60000,
    );
    const endTimeStr = formatTime(endTime);

    // 2. Find candidate doctors offering this service (or specific doctor)
    const doctorLinks = await this.prisma.db.doctor_services.findMany({
      where: {
        service_id: serviceRow.id,
        ...(doctorName
          ? {
              doctor: {
                name: { equals: doctorName.trim(), mode: 'insensitive' },
              },
            }
          : {}),
      },
      include: { doctors: true },
    });

    if (doctorLinks.length === 0) {
      return {
        status: 'DOCTOR_NOT_AVAILABLE',
        message: doctorName
          ? `Doctor "${doctorName}" does not offer "${serviceName}".`
          : `No doctor available for "${serviceName}".`,
      };
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
    const doctorHoursRows = await this.prisma.db.doctor_hours.findMany({
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

    const existingBookings = await this.prisma.db.$queryRaw<BookingRow[]>`
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
      const booking = await this.prisma.db.bookings.create({
        data: {
          tenant_id: tenantId,
          doctor_id: availableDoctor.doctor_id,
          service_id: serviceRow.id,
          start_time: startTime,
          end_time: endTime,
          client_phone: clientPhone,
        },
      });

      return {
        status: 'CONFIRMED',
        bookingId: booking.id,
        doctorName: availableDoctor.doctorName,
        date: cleanDate,
        time: cleanTime,
      };
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

    return {
      status: 'UNAVAILABLE',
      reason:
        workingCandidates.length === 0 ? 'OUTSIDE_HOURS' : 'ALREADY_BOOKED',
      alternatives,
      date: cleanDate,
      time: cleanTime,
      nextDay: nextDayStr,
    };
  }
}
