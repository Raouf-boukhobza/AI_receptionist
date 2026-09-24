import { Injectable, Logger } from '@nestjs/common';
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
import { ReminderQueue } from './queue/reminder.queue';
import { bookings, Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../common/tenant-context/tenant-transaction';

export interface CreateBookingParams {
  tenantId: string;
  clientPhone: string;
  serviceName: string;
  date: string;
  time: string;
  doctorName?: string;
}

export interface UpdateBookingParams {
  tenantId: string;
  clientPhone: string;
  bookingId?: string;
  serviceName?: string;
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

export type UpdateBookingResult =
  | {
      status: 'UPDATED';
      bookingId: string;
      doctorName: string;
      serviceName: string;
      date: string;
      time: string;
      oldReminder24hJobId?: string | null;
      oldReminder1hJobId?: string | null;
    }
  | {
      status: 'BOOKING_NOT_FOUND';
      message: string;
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
      serviceName: string;
    };

export interface CancelBookingParams {
  tenantId: string;
  clientPhone: string;
  bookingId?: string;
}

export type CancelBookingResult =
  | {
      status: 'CANCELLED';
      bookingId: string;
      doctorName: string;
      serviceName: string;
      date: string;
      time: string;
      reminder24hJobId?: string | null;
      reminder1hJobId?: string | null;
    }
  | {
      status: 'BOOKING_NOT_FOUND';
      message: string;
    };

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderQueue: ReminderQueue,
    private readonly tenantTransaction: TenantTransaction,
  ) {}

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

    // Resolve day of week for requested date and next day
    const requestedDayOfWeek = getDayOfWeek(cleanDate);
    const nextDayStr = getNextDayStr(cleanDate);
    const nextDayOfWeek = getDayOfWeek(nextDayStr);

    if (Number.isNaN(startTime.getTime()) || startTime.getTime() <= new Date().getTime()) {
      return {
        status: 'UNAVAILABLE',
        reason: 'OUTSIDE_HOURS',
        alternatives: [],
        date: cleanDate,
        time: cleanTime,
        nextDay: nextDayStr,
      };
    }

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
        AND end_time >= ${dayStart}
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
    const availableDoctors = workingCandidates.filter((c) => {
      const doctorBookings = bookingsByDoctor.get(c.doctor_id) ?? [];
      return !hasConflict(doctorBookings, startTime, endTime);
    });

    if (availableDoctors.length) {
      let booking: bookings | null = null;
      let bookedDoctor: (typeof availableDoctors)[number] | null = null;

      for (const doctor of availableDoctors) {
        try {
          booking = await this.prisma.db.bookings.create({
            data: {
              tenant_id: tenantId,
              doctor_id: doctor.doctor_id,
              service_id: serviceRow.id,
              start_time: startTime,
              end_time: endTime,
              client_phone: clientPhone,
            },
          });

          bookedDoctor = doctor;
          break;
        } catch (error) {
          if (
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002') ||
            (error as any).code === '23P01' ||
            (error as any).meta?.driverAdapterError?.cause?.code === '23P01'
          ) {
            this.logger.warn(
              `Doctor ${doctor.doctor_id} was booked concurrently.`,
            );
            continue;
          }

          throw error;
        }
      }

      if (booking && bookedDoctor) {
        return {
          status: 'CONFIRMED',
          bookingId: booking.id,
          doctorName: bookedDoctor.doctorName,
          date: cleanDate,
          time: cleanTime,
        };
      }
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

  async createReminders(tenantId: string , startTime: Date, bookingId: string ) {
    const timeOneDayBefore = new Date(
      startTime.getTime() - 24 * 60 * 60 * 1000,
    );
    const timeOneHourBefore = new Date(startTime.getTime() - 60 * 60 * 1000);
    try {
      const now = Date.now();

      let reminder_24h_job_id: string | undefined;
      let reminder_1h_job_id: string | undefined;

      if (timeOneDayBefore.getTime() > now) {
        const job = await this.reminderQueue.addJob(
          { bookingId, tenantId },
          timeOneDayBefore,
        );
        reminder_24h_job_id = job?.id;
      }

      if (timeOneHourBefore.getTime() > now) {
        const job = await this.reminderQueue.addJob(
          { bookingId, tenantId },
          timeOneHourBefore,
        );
        reminder_1h_job_id = job?.id;
      }

      if (reminder_24h_job_id || reminder_1h_job_id) {
        await this.tenantTransaction.run(tenantId, async (tx) => {
          await tx.bookings.update({
            where: { id: bookingId },
            data: {
              ...(reminder_24h_job_id ? { reminder_24h_job_id } : {}),
              ...(reminder_1h_job_id ? { reminder_1h_job_id } : {}),
            },
          });
        });
      }
    } catch (reminderError) {
      this.logger.error(
        `Failed to schedule reminders for booking ${bookingId}: ${
          (reminderError as Error)?.message
        }`,
      );
    }
  }

  async cancelReminder(jobId?: string | null) {
    if (!jobId) return;
    try {
      await this.reminderQueue.removeJob(jobId);
    } catch (error) {
      this.logger.warn(
        `Failed to remove reminder job ${jobId}: ${
          (error as Error)?.message
        }`,
      );
    }
  }

  async updateBooking(params: UpdateBookingParams): Promise<UpdateBookingResult> {
    const { tenantId, clientPhone, bookingId, serviceName, date, time, doctorName } =
      params;

    // 1. Resolve existing booking
    let existingBooking;
    if (bookingId) {
      existingBooking = await this.prisma.db.bookings.findFirst({
        where: {
          id: bookingId,
          client_phone: clientPhone,
          status: { not: 'cancelled' },
        },
        include: {
          services: true,
          doctors: true,
        },
      });
    } else {
      existingBooking = await this.prisma.db.bookings.findFirst({
        where: {
          client_phone: clientPhone,
          status: 'confirmed',
          end_time: { gte: new Date() },
        },
        orderBy: {
          start_time: 'asc',
        },
        include: {
          services: true,
          doctors: true,
        },
      });
    }

    if (!existingBooking) {
      return {
        status: 'BOOKING_NOT_FOUND',
        message: 'No active booking found to update.',
      };
    }

    // 2. Resolve service
    let serviceRow = existingBooking.services;
    if (
      serviceName &&
      serviceName.trim().toLowerCase() !== existingBooking.services.name.toLowerCase()
    ) {
      const found = await this.prisma.db.services.findFirst({
        where: { name: { equals: serviceName.trim(), mode: 'insensitive' } },
      });
      if (!found) {
        return {
          status: 'SERVICE_NOT_FOUND',
          message: `Service "${serviceName}" not found.`,
        };
      }
      serviceRow = found;
    }

    const cleanDate = date.trim();
    const cleanTime = normalizeTime(time);

    const startTime = new Date(`${cleanDate}T${cleanTime}:00`);
    const endTime = new Date(
      startTime.getTime() + serviceRow.duration_minutes * 60000,
    );
    const endTimeStr = formatTime(endTime);

    // Resolve day of week for requested date and next day
    const requestedDayOfWeek = getDayOfWeek(cleanDate);
    const nextDayStr = getNextDayStr(cleanDate);
    const nextDayOfWeek = getDayOfWeek(nextDayStr);

    if (
      Number.isNaN(startTime.getTime()) ||
      startTime.getTime() <= new Date().getTime()
    ) {
      return {
        status: 'UNAVAILABLE',
        reason: 'OUTSIDE_HOURS',
        alternatives: [],
        date: cleanDate,
        time: cleanTime,
        nextDay: nextDayStr,
        serviceName: serviceRow.name,
      };
    }

    // 3. Find candidate doctors offering this service (or specific doctor)
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
          ? `Doctor "${doctorName}" does not offer "${serviceRow.name}".`
          : `No doctor available for "${serviceRow.name}".`,
      };
    }

    let candidates: CandidateDoctor[] = doctorLinks.map((dl) => ({
      doctor_id: dl.doctor_id,
      doctorName: dl.doctors.name,
    }));

    // If no specific doctor was requested, prioritize the existing booking's doctor if present
    if (!doctorName) {
      candidates = candidates.sort((a, b) =>
        a.doctor_id === existingBooking.doctor_id
          ? -1
          : b.doctor_id === existingBooking.doctor_id
            ? 1
            : 0,
      );
    }
    const doctorIds = candidates.map((c) => c.doctor_id);

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

    // 5. Batch-fetch existing non-cancelled bookings for candidates, excluding the current booking being updated
    const dayStart = new Date(`${cleanDate}T00:00:00`);
    const nextDayEnd = new Date(`${nextDayStr}T23:59:59`);

    const existingBookings = await this.prisma.db.$queryRaw<BookingRow[]>`
      SELECT doctor_id, start_time, end_time
      FROM bookings
      WHERE doctor_id = ANY(${doctorIds}::uuid[])
        AND id != ${existingBooking.id}::uuid
        AND end_time >= ${dayStart}
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
    const availableDoctors = workingCandidates.filter((c) => {
      const doctorBookings = bookingsByDoctor.get(c.doctor_id) ?? [];
      return !hasConflict(doctorBookings, startTime, endTime);
    });

    if (availableDoctors.length) {
      let updatedBooking: bookings | null = null;
      let bookedDoctor: (typeof availableDoctors)[number] | null = null;

      for (const doctor of availableDoctors) {
        try {
          updatedBooking = await this.prisma.db.bookings.update({
            where: { id: existingBooking.id },
            data: {
              doctor_id: doctor.doctor_id,
              service_id: serviceRow.id,
              start_time: startTime,
              end_time: endTime,
              status: 'confirmed',
              updated_at: new Date(),
              reminder_24h_job_id: null,
              reminder_1h_job_id: null
            },
          });

          bookedDoctor = doctor;

          break;
        } catch (error) {
          if (
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002') ||
            (error as any).code === '23P01' ||
            (error as any).meta?.driverAdapterError?.cause?.code === '23P01'
          ) {
            this.logger.warn(
              `Doctor ${doctor.doctor_id} was booked concurrently during update.`,
            );
            continue;
          }

          throw error;
        }
      }

      if (updatedBooking && bookedDoctor) {
        return {
          status: 'UPDATED',
          bookingId: updatedBooking.id,
          doctorName: bookedDoctor.doctorName,
          serviceName: serviceRow.name,
          date: cleanDate,
          time: cleanTime,
          oldReminder24hJobId: existingBooking.reminder_24h_job_id,
          oldReminder1hJobId: existingBooking.reminder_1h_job_id,
        };
      }
    }

    // 8. Slot not available -> generate valid alternatives
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
      serviceName: serviceRow.name,
    };
  }

  async cancelBooking(params: CancelBookingParams): Promise<CancelBookingResult> {
    const { clientPhone, bookingId } = params;

    let existingBooking;
    if (bookingId) {
      existingBooking = await this.prisma.db.bookings.findFirst({
        where: {
          id: bookingId,
          client_phone: clientPhone,
          status: { not: 'cancelled' },
        },
        include: {
          services: true,
          doctors: true,
        },
      });
    } else {
      existingBooking = await this.prisma.db.bookings.findFirst({
        where: {
          client_phone: clientPhone,
          status: 'confirmed',
          end_time: { gte: new Date() },
        },
        orderBy: {
          start_time: 'asc',
        },
        include: {
          services: true,
          doctors: true,
        },
      });
    }

    if (!existingBooking) {
      return {
        status: 'BOOKING_NOT_FOUND',
        message: 'No active booking found to cancel.',
      };
    }

    await this.prisma.db.bookings.update({
      where: { id: existingBooking.id },
      data: {
        status: 'cancelled',
        updated_at: new Date(),
        reminder_24h_job_id: null,
        reminder_1h_job_id: null,
      },
    });

    const date = existingBooking.start_time.toISOString().split('T')[0];
    const time = formatTime(existingBooking.start_time);

    return {
      status: 'CANCELLED',
      bookingId: existingBooking.id,
      doctorName: existingBooking.doctors.name,
      serviceName: existingBooking.services.name,
      date,
      time,
      reminder24hJobId: existingBooking.reminder_24h_job_id,
      reminder1hJobId: existingBooking.reminder_1h_job_id,
    };
  }
}
