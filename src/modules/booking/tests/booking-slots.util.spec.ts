import {
  getDayOfWeek,
  getNextDayStr,
  normalizeTime,
  formatTime,
  isWithinWorkingHours,
  hasConflict,
  generateTimeSlots,
  findAvailableSlots,
  BookingRow,
  DoctorWorkingHours,
} from '../utils/booking-slots.util';

describe('BookingSlotsUtil', () => {
  describe('getDayOfWeek', () => {
    it('should correctly map all days of the week from YYYY-MM-DD date strings', () => {
      // 2026-08-23 is Sunday
      expect(getDayOfWeek('2026-08-23')).toBe('SUNDAY');
      // 2026-08-24 is Monday
      expect(getDayOfWeek('2026-08-24')).toBe('MONDAY');
      // 2026-08-25 is Tuesday
      expect(getDayOfWeek('2026-08-25')).toBe('TUESDAY');
      // 2026-08-26 is Wednesday
      expect(getDayOfWeek('2026-08-26')).toBe('WEDNESDAY');
      // 2026-08-27 is Thursday
      expect(getDayOfWeek('2026-08-27')).toBe('THURSDAY');
      // 2026-08-28 is Friday
      expect(getDayOfWeek('2026-08-28')).toBe('FRIDAY');
      // 2026-08-29 is Saturday
      expect(getDayOfWeek('2026-08-29')).toBe('SATURDAY');
    });
  });

  describe('getNextDayStr', () => {
    it('should return next day for regular dates within the same month', () => {
      expect(getNextDayStr('2026-08-25')).toBe('2026-08-26');
      expect(getNextDayStr('2026-08-01')).toBe('2026-08-02');
    });

    it('should roll over to the next month for month-end dates', () => {
      expect(getNextDayStr('2026-01-31')).toBe('2026-02-01');
      expect(getNextDayStr('2026-02-28')).toBe('2026-03-01');
      expect(getNextDayStr('2026-04-30')).toBe('2026-05-01');
    });

    it('should roll over to the next year for December 31st', () => {
      expect(getNextDayStr('2026-12-31')).toBe('2027-01-01');
    });
  });

  describe('normalizeTime', () => {
    it('should pad single-digit hour with leading zero', () => {
      expect(normalizeTime('9:00')).toBe('09:00');
      expect(normalizeTime('8:30')).toBe('08:30');
    });

    it('should preserve already formatted two-digit hour', () => {
      expect(normalizeTime('09:00')).toBe('09:00');
      expect(normalizeTime('14:30')).toBe('14:30');
      expect(normalizeTime('23:59')).toBe('23:59');
    });

    it('should trim surrounding whitespace', () => {
      expect(normalizeTime('  9:00 ')).toBe('09:00');
      expect(normalizeTime(' 15:45  ')).toBe('15:45');
    });
  });

  describe('formatTime', () => {
    it('should format Date instance to HH:mm with zero padding', () => {
      const d1 = new Date(2026, 7, 25, 9, 5);
      expect(formatTime(d1)).toBe('09:05');

      const d2 = new Date(2026, 7, 25, 14, 30);
      expect(formatTime(d2)).toBe('14:30');
    });
  });

  describe('isWithinWorkingHours', () => {
    const workingHours: DoctorWorkingHours = {
      start_time: '09:00',
      end_time: '17:00',
    };

    it('should return false if working hours are undefined', () => {
      expect(isWithinWorkingHours(undefined, '09:00', '09:30')).toBe(false);
    });

    it('should return true when slot is fully within working hours', () => {
      expect(isWithinWorkingHours(workingHours, '09:00', '09:30')).toBe(true);
      expect(isWithinWorkingHours(workingHours, '10:00', '11:00')).toBe(true);
      expect(isWithinWorkingHours(workingHours, '16:30', '17:00')).toBe(true);
    });

    it('should return true for exact matching start and end boundaries', () => {
      expect(isWithinWorkingHours(workingHours, '09:00', '17:00')).toBe(true);
    });

    it('should return false when slot starts before working hours', () => {
      expect(isWithinWorkingHours(workingHours, '08:30', '09:30')).toBe(false);
    });

    it('should return false when slot ends after working hours', () => {
      expect(isWithinWorkingHours(workingHours, '16:30', '17:30')).toBe(false);
    });

    it('should return false when slot is completely outside working hours', () => {
      expect(isWithinWorkingHours(workingHours, '07:00', '08:00')).toBe(false);
      expect(isWithinWorkingHours(workingHours, '18:00', '19:00')).toBe(false);
    });
  });

  describe('hasConflict', () => {
    const existingBookings: BookingRow[] = [
      {
        doctor_id: 'doc-1',
        start_time: new Date('2026-08-25T10:00:00'),
        end_time: new Date('2026-08-25T10:30:00'),
      },
      {
        doctor_id: 'doc-1',
        start_time: new Date('2026-08-25T14:00:00'),
        end_time: new Date('2026-08-25T15:00:00'),
      },
    ];

    it('should return false when bookings list is empty', () => {
      const start = new Date('2026-08-25T10:00:00');
      const end = new Date('2026-08-25T10:30:00');
      expect(hasConflict([], start, end)).toBe(false);
    });

    it('should return false when slot is completely before or after existing bookings', () => {
      // Before 10:00
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T09:00:00'),
          new Date('2026-08-25T09:30:00'),
        ),
      ).toBe(false);

      // Between 10:30 and 14:00
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T11:00:00'),
          new Date('2026-08-25T12:00:00'),
        ),
      ).toBe(false);

      // After 15:00
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T15:30:00'),
          new Date('2026-08-25T16:00:00'),
        ),
      ).toBe(false);
    });

    it('should return false on exact boundary touches (adjacent bookings)', () => {
      // Ends exactly when existing booking starts
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T09:30:00'),
          new Date('2026-08-25T10:00:00'),
        ),
      ).toBe(false);

      // Starts exactly when existing booking ends
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T10:30:00'),
          new Date('2026-08-25T11:00:00'),
        ),
      ).toBe(false);
    });

    it('should return true on exact same slot collision', () => {
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T10:00:00'),
          new Date('2026-08-25T10:30:00'),
        ),
      ).toBe(true);
    });

    it('should return true on partial overlap at the beginning', () => {
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T09:45:00'),
          new Date('2026-08-25T10:15:00'),
        ),
      ).toBe(true);
    });

    it('should return true on partial overlap at the end', () => {
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T10:15:00'),
          new Date('2026-08-25T10:45:00'),
        ),
      ).toBe(true);
    });

    it('should return true when requested slot encloses an existing booking', () => {
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T09:30:00'),
          new Date('2026-08-25T11:00:00'),
        ),
      ).toBe(true);
    });

    it('should return true when requested slot is inside a longer existing booking', () => {
      expect(
        hasConflict(
          existingBookings,
          new Date('2026-08-25T14:15:00'),
          new Date('2026-08-25T14:45:00'),
        ),
      ).toBe(true);
    });
  });

  describe('generateTimeSlots', () => {
    it('should generate 30-minute intervals within working window', () => {
      const slots = generateTimeSlots('09:00', '11:00', 30, 30);
      expect(slots).toEqual(['09:00', '09:30', '10:00', '10:30']);
    });

    it('should respect service duration and omit slots that would exceed end time', () => {
      // 45-min duration with 30-min step
      // 09:00 + 45 = 09:45 <= 11:00 (ok)
      // 09:30 + 45 = 10:15 <= 11:00 (ok)
      // 10:00 + 45 = 10:45 <= 11:00 (ok)
      // 10:30 + 45 = 11:15 > 11:00 (excluded)
      const slots = generateTimeSlots('09:00', '11:00', 30, 45);
      expect(slots).toEqual(['09:00', '09:30', '10:00']);
    });

    it('should handle hour rollovers properly across wide ranges', () => {
      const slots = generateTimeSlots('08:45', '10:15', 30, 30);
      expect(slots).toEqual(['08:45', '09:15', '09:45']);
    });

    it('should return empty array when start time is after end time', () => {
      const slots = generateTimeSlots('17:00', '09:00', 30, 30);
      expect(slots).toEqual([]);
    });
  });

  describe('findAvailableSlots', () => {
    const existingBookings: BookingRow[] = [
      {
        doctor_id: 'doc-1',
        start_time: new Date('2026-08-25T09:30:00'),
        end_time: new Date('2026-08-25T10:00:00'),
      },
      {
        doctor_id: 'doc-1',
        start_time: new Date('2026-08-25T11:00:00'),
        end_time: new Date('2026-08-25T11:30:00'),
      },
    ];

    it('should return all generated slots when no conflicts exist', () => {
      const available = findAvailableSlots(
        [],
        '2026-08-25',
        '09:00',
        '11:00',
        30,
      );
      expect(available).toEqual(['09:00', '09:30', '10:00', '10:30']);
    });

    it('should filter out slots that conflict with existing bookings', () => {
      const available = findAvailableSlots(
        existingBookings,
        '2026-08-25',
        '09:00',
        '12:00',
        30,
      );
      // Possible slots: 09:00, 09:30 (conflict), 10:00, 10:30, 11:00 (conflict), 11:30
      expect(available).toEqual(['09:00', '10:00', '10:30', '11:30']);
    });
  });
});
