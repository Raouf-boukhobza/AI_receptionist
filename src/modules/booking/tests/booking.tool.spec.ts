import {
  createBookingTool,
  createUpdateBookingTool,
} from '../../agent/graph/tools/booking.tool';
import { BookingService } from '../booking.service';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';

describe('BookingTool', () => {
  let mockBookingService: {
    createBooking: jest.Mock;
    updateBooking: jest.Mock;
    createReminders: jest.Mock;
    cancelReminder: jest.Mock;
  };
  let mockTenantTransaction: { run: jest.Mock };
  let bookingTool: ReturnType<typeof createBookingTool>;
  let updateBookingTool: ReturnType<typeof createUpdateBookingTool>;

  const validConfig = {
    configurable: {
      tenantId: 'tenant-123',
      phoneNumber: '+1234567890',
    },
  };

  const defaultInput = {
    service: 'Consultation',
    date: '2026-08-25',
    time: '10:00',
  };

  beforeEach(() => {
    mockBookingService = {
      createBooking: jest.fn(),
      updateBooking: jest.fn(),
      createReminders: jest.fn().mockResolvedValue(undefined),
      cancelReminder: jest.fn().mockResolvedValue(undefined),
    };

    mockTenantTransaction = {
      run: jest.fn(async (_tenantId: string, fn: (tx?: any) => Promise<any>) =>
        fn({}),
      ),
    };

    bookingTool = createBookingTool(
      mockBookingService as unknown as BookingService,
      mockTenantTransaction as unknown as TenantTransaction,
    );

    updateBookingTool = createUpdateBookingTool(
      mockBookingService as unknown as BookingService,
      mockTenantTransaction as unknown as TenantTransaction,
    );
  });

  describe('create_booking', () => {
    describe('Tool Definition', () => {
      it('should have correct name and description', () => {
        expect(bookingTool.name).toBe('create_booking');
        expect(bookingTool.description).toContain('Book an appointment');
      });
    });

    describe('Configuration Validation', () => {
      it('should throw an error if tenantId is missing from config', async () => {
        await expect(
          bookingTool.invoke(defaultInput, {
            configurable: { phoneNumber: '+1234567890' },
          }),
        ).rejects.toThrow(
          'Tenant context or phone number missing from tool execution',
        );
      });

      it('should throw an error if phoneNumber is missing from config', async () => {
        await expect(
          bookingTool.invoke(defaultInput, {
            configurable: { tenantId: 'tenant-123' },
          }),
        ).rejects.toThrow(
          'Tenant context or phone number missing from tool execution',
        );
      });

      it('should throw an error if configurable object is undefined', async () => {
        await expect(bookingTool.invoke(defaultInput, {})).rejects.toThrow(
          'Tenant context or phone number missing from tool execution',
        );
      });
    });

    describe('Execution & Output Formatting', () => {
      it('should call tenantTransaction.run with tenantId and return confirmation message for CONFIRMED status', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'CONFIRMED',
          bookingId: 'booking-abc',
          doctorName: 'Alice',
          date: '2026-08-25',
          time: '10:00',
        });

        const response = await bookingTool.invoke(
          { ...defaultInput, doctorName: 'Dr. Alice' },
          validConfig,
        );

        expect(mockTenantTransaction.run).toHaveBeenCalledWith(
          'tenant-123',
          expect.any(Function),
        );
        expect(mockBookingService.createBooking).toHaveBeenCalledWith({
          tenantId: 'tenant-123',
          clientPhone: '+1234567890',
          serviceName: 'Consultation',
          date: '2026-08-25',
          time: '10:00',
          doctorName: 'Dr. Alice',
        });
        expect(mockBookingService.createReminders).toHaveBeenCalledWith(
          'tenant-123',
          new Date('2026-08-25T10:00:00'),
          'booking-abc',
        );
        expect(response).toBe(
          'Booking confirmed with Dr. Alice on 2026-08-25 at 10:00. Booking id: booking-abc',
        );
      });

      it('should return error message when status is SERVICE_NOT_FOUND', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'SERVICE_NOT_FOUND',
          message: 'Service "Consultation" not found.',
        });

        const response = await bookingTool.invoke(defaultInput, validConfig);

        expect(response).toBe('Service "Consultation" not found.');
      });

      it('should return error message when status is DOCTOR_NOT_AVAILABLE', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'DOCTOR_NOT_AVAILABLE',
          message: 'Doctor "Dr. House" does not offer "Consultation".',
        });

        const response = await bookingTool.invoke(
          { ...defaultInput, doctorName: 'Dr. House' },
          validConfig,
        );

        expect(response).toBe('Doctor "Dr. House" does not offer "Consultation".');
      });

      it('should format UNAVAILABLE with OUTSIDE_HOURS and alternatives properly', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'OUTSIDE_HOURS',
          date: '2026-08-25',
          time: '15:00',
          nextDay: '2026-08-26',
          alternatives: [
            'Dr. Alice: 09:00, 09:30 (2026-08-25)',
            'Dr. Alice: 10:00, 10:30 (2026-08-26)',
          ],
        });

        const response = await bookingTool.invoke(
          { ...defaultInput, time: '15:00' },
          validConfig,
        );

        expect(response).toContain(
          'The requested time (15:00 on 2026-08-25) is outside working hours. Available alternatives:',
        );
        expect(response).toContain('Dr. Alice: 09:00, 09:30 (2026-08-25)');
        expect(response).toContain('Dr. Alice: 10:00, 10:30 (2026-08-26)');
      });

      it('should format UNAVAILABLE with ALREADY_BOOKED and alternatives properly', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'ALREADY_BOOKED',
          date: '2026-08-25',
          time: '10:00',
          nextDay: '2026-08-26',
          alternatives: ['Dr. Alice: 09:00, 09:30, 10:30 (2026-08-25)'],
        });

        const response = await bookingTool.invoke(defaultInput, validConfig);

        expect(response).toBe(
          'Requested slot (10:00 on 2026-08-25) is already booked. Available alternatives:\nDr. Alice: 09:00, 09:30, 10:30 (2026-08-25)',
        );
      });

      it('should return helpful message when UNAVAILABLE (OUTSIDE_HOURS) and no alternatives exist', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'OUTSIDE_HOURS',
          date: '2026-08-25',
          time: '19:00',
          nextDay: '2026-08-26',
          alternatives: [],
        });

        const response = await bookingTool.invoke(
          { ...defaultInput, time: '19:00' },
          validConfig,
        );

        expect(response).toBe(
          'No working hours or availability found for "Consultation" on 2026-08-25 or 2026-08-26.',
        );
      });

      it('should return helpful message when UNAVAILABLE (ALREADY_BOOKED) and no alternatives exist', async () => {
        mockBookingService.createBooking!.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'ALREADY_BOOKED',
          date: '2026-08-25',
          time: '10:00',
          nextDay: '2026-08-26',
          alternatives: [],
        });

        const response = await bookingTool.invoke(defaultInput, validConfig);

        expect(response).toBe(
          'No availability found for "Consultation" on 2026-08-25 or 2026-08-26.',
        );
      });
    });
  });

  describe('update_booking', () => {
    const defaultUpdateInput = {
      date: '2026-08-26',
      time: '11:00',
    };

    describe('Tool Definition', () => {
      it('should have correct name and description', () => {
        expect(updateBookingTool.name).toBe('update_booking');
        expect(updateBookingTool.description).toContain(
          'Update or reschedule an existing appointment',
        );
      });
    });

    describe('Configuration Validation', () => {
      it('should throw an error if tenantId is missing from config', async () => {
        await expect(
          updateBookingTool.invoke(defaultUpdateInput, {
            configurable: { phoneNumber: '+1234567890' },
          }),
        ).rejects.toThrow(
          'Tenant context or phone number missing from tool execution',
        );
      });

      it('should throw an error if phoneNumber is missing from config', async () => {
        await expect(
          updateBookingTool.invoke(defaultUpdateInput, {
            configurable: { tenantId: 'tenant-123' },
          }),
        ).rejects.toThrow(
          'Tenant context or phone number missing from tool execution',
        );
      });

      it('should throw an error if configurable object is undefined', async () => {
        await expect(
          updateBookingTool.invoke(defaultUpdateInput, {}),
        ).rejects.toThrow(
          'Tenant context or phone number missing from tool execution',
        );
      });
    });

    describe('Execution & Output Formatting', () => {
      it('should call updateBooking, cancel old reminders, create new reminders and format UPDATED response', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'UPDATED',
          bookingId: 'booking-xyz',
          doctorName: 'Alice',
          serviceName: 'Teeth Cleaning',
          date: '2026-08-26',
          time: '11:00',
          oldReminder24hJobId: 'job-old-24h',
          oldReminder1hJobId: 'job-old-1h',
        });

        const response = await updateBookingTool.invoke(
          {
            ...defaultUpdateInput,
            bookingId: 'booking-xyz',
            service: 'Teeth Cleaning',
            doctorName: 'Dr. Alice',
          },
          validConfig,
        );

        expect(mockTenantTransaction.run).toHaveBeenCalledWith(
          'tenant-123',
          expect.any(Function),
        );
        expect(mockBookingService.updateBooking).toHaveBeenCalledWith({
          tenantId: 'tenant-123',
          clientPhone: '+1234567890',
          bookingId: 'booking-xyz',
          serviceName: 'Teeth Cleaning',
          date: '2026-08-26',
          time: '11:00',
          doctorName: 'Dr. Alice',
        });
        expect(mockBookingService.cancelReminder).toHaveBeenCalledWith('job-old-24h');
        expect(mockBookingService.cancelReminder).toHaveBeenCalledWith('job-old-1h');
        expect(mockBookingService.createReminders).toHaveBeenCalledWith(
          'tenant-123',
          new Date('2026-08-26T11:00:00'),
          'booking-xyz',
        );
        expect(response).toBe(
          'Booking updated successfully with Dr. Alice for Teeth Cleaning on 2026-08-26 at 11:00. Booking id: booking-xyz',
        );
      });

      it('should return error message when status is BOOKING_NOT_FOUND', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'BOOKING_NOT_FOUND',
          message: 'No active booking found to update.',
        });

        const response = await updateBookingTool.invoke(
          defaultUpdateInput,
          validConfig,
        );

        expect(response).toBe('No active booking found to update.');
      });

      it('should return error message when status is SERVICE_NOT_FOUND', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'SERVICE_NOT_FOUND',
          message: 'Service "Unknown" not found.',
        });

        const response = await updateBookingTool.invoke(
          defaultUpdateInput,
          validConfig,
        );

        expect(response).toBe('Service "Unknown" not found.');
      });

      it('should return error message when status is DOCTOR_NOT_AVAILABLE', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'DOCTOR_NOT_AVAILABLE',
          message: 'Doctor "Dr. Strange" does not offer "Consultation".',
        });

        const response = await updateBookingTool.invoke(
          defaultUpdateInput,
          validConfig,
        );

        expect(response).toBe(
          'Doctor "Dr. Strange" does not offer "Consultation".',
        );
      });

      it('should format UNAVAILABLE with OUTSIDE_HOURS and alternatives properly', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'OUTSIDE_HOURS',
          date: '2026-08-26',
          time: '15:00',
          nextDay: '2026-08-27',
          serviceName: 'Consultation',
          alternatives: ['Dr. Alice: 09:00, 09:30 (2026-08-26)'],
        });

        const response = await updateBookingTool.invoke(
          { ...defaultUpdateInput, time: '15:00' },
          validConfig,
        );

        expect(response).toBe(
          'The requested time (15:00 on 2026-08-26) is outside working hours. Available alternatives:\nDr. Alice: 09:00, 09:30 (2026-08-26)',
        );
      });

      it('should format UNAVAILABLE with ALREADY_BOOKED and alternatives properly', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'ALREADY_BOOKED',
          date: '2026-08-26',
          time: '11:00',
          nextDay: '2026-08-27',
          serviceName: 'Consultation',
          alternatives: ['Dr. Alice: 09:00, 09:30, 11:30 (2026-08-26)'],
        });

        const response = await updateBookingTool.invoke(
          defaultUpdateInput,
          validConfig,
        );

        expect(response).toBe(
          'Requested slot (11:00 on 2026-08-26) is already booked. Available alternatives:\nDr. Alice: 09:00, 09:30, 11:30 (2026-08-26)',
        );
      });

      it('should return helpful message when UNAVAILABLE (OUTSIDE_HOURS) and no alternatives exist', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'OUTSIDE_HOURS',
          date: '2026-08-26',
          time: '19:00',
          nextDay: '2026-08-27',
          serviceName: 'Consultation',
          alternatives: [],
        });

        const response = await updateBookingTool.invoke(
          { ...defaultUpdateInput, time: '19:00' },
          validConfig,
        );

        expect(response).toBe(
          'No working hours or availability found for "Consultation" on 2026-08-26 or 2026-08-27.',
        );
      });

      it('should return helpful message when UNAVAILABLE (ALREADY_BOOKED) and no alternatives exist', async () => {
        mockBookingService.updateBooking.mockResolvedValue({
          status: 'UNAVAILABLE',
          reason: 'ALREADY_BOOKED',
          date: '2026-08-26',
          time: '11:00',
          nextDay: '2026-08-27',
          serviceName: 'Consultation',
          alternatives: [],
        });

        const response = await updateBookingTool.invoke(
          defaultUpdateInput,
          validConfig,
        );

        expect(response).toBe(
          'No availability found for "Consultation" on 2026-08-26 or 2026-08-27.',
        );
      });
    });
  });
});

