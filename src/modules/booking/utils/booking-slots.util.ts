// ─── Pure helpers (no DB calls) ───────────────────────────────────────────────

import { day_of_week } from '../../../../generated/prisma/enums';

export interface BookingRow {
  doctor_id: string;
  start_time: Date;
  end_time: Date;
}

export interface CandidateDoctor {
  doctor_id: string;
  doctorName: string;
}

export interface DoctorWorkingHours {
  start_time: string;
  end_time: string;
}

export const DAYS_OF_WEEK: day_of_week[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

export function getDayOfWeek(dateStr: string): day_of_week {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return DAYS_OF_WEEK[date.getDay()];
}

export function getNextDayStr(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeTime(timeStr: string): string {
  const parts = timeStr.trim().split(':');
  if (parts.length === 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
  }
  return timeStr.trim();
}

export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function isWithinWorkingHours(
  workingHours: DoctorWorkingHours | undefined,
  startTimeStr: string,
  endTimeStr: string,
): boolean {
  if (!workingHours) return false;

  return (
    startTimeStr >= workingHours.start_time &&
    endTimeStr >= workingHours.start_time &&
    endTimeStr <= workingHours.end_time
  );
}

export function hasConflict(
  bookings: BookingRow[],
  start: Date,
  end: Date,
): boolean {
  return bookings.some((b) => b.start_time < end && b.end_time > start);
}

export function generateTimeSlots(
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

export function findAvailableSlots(
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
