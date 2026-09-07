import { Test, TestingModule } from '@nestjs/testing';
import { BookingService } from '../booking.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ReminderQueue } from '../queue/reminder.queue';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';

describe('BookingService', () => {
  let service: BookingService;

  const mockTx = {
    bookings: {
      update: jest.fn(),
    },
  };

  const mockTenantTransaction = {
    run: jest.fn(async (_tenantId: string, fn: (tx: any) => Promise<any>) =>
      fn(mockTx),
    ),
  };

  const mockDb = {
    services: {
      findFirst: jest.fn(),
    },
    doctor_services: {
      findMany: jest.fn(),
    },
    doctor_hours: {
      findMany: jest.fn(),
    },
    bookings: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const mockReminderQueue = {
    addJob: jest.fn().mockResolvedValue({ id: 'job-123' }),
    removeJob: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrismaService = {
    get db() {
      return mockDb;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ReminderQueue,
          useValue: mockReminderQueue,
        },
        {
          provide: TenantTransaction,
          useValue: mockTenantTransaction,
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createBooking', () => {
    const defaultParams = {
      tenantId: 'tenant-123',
      clientPhone: '+1234567890',
      serviceName: 'Consultation',
      date: '2026-08-25', // Tuesday
      time: '10:00',
    };

    const mockServiceRow = {
      id: 'svc-1',
      name: 'Consultation',
      duration_minutes: 30,
    };

    it('should return SERVICE_NOT_FOUND when service does not exist', async () => {
      mockDb.services.findFirst.mockResolvedValue(null);

      const result = await service.createBooking(defaultParams);

      expect(mockDb.services.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: 'Consultation', mode: 'insensitive' } },
      });
      expect(result).toEqual({
        status: 'SERVICE_NOT_FOUND',
        message: 'Service "Consultation" not found.',
      });
      expect(mockDb.doctor_services.findMany).not.toHaveBeenCalled();
      expect(mockDb.bookings.create).not.toHaveBeenCalled();
    });

    it('should return DOCTOR_NOT_AVAILABLE when no doctor offers the service', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([]);

      const result = await service.createBooking(defaultParams);

      expect(result).toEqual({
        status: 'DOCTOR_NOT_AVAILABLE',
        message: 'No doctor available for "Consultation".',
      });
      expect(mockDb.bookings.create).not.toHaveBeenCalled();
    });

    it('should return DOCTOR_NOT_AVAILABLE with custom message when requested doctor is not found for the service', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([]);

      const result = await service.createBooking({
        ...defaultParams,
        doctorName: 'Dr. House',
      });

      expect(mockDb.doctor_services.findMany).toHaveBeenCalledWith({
        where: {
          service_id: 'svc-1',
          doctor: {
            name: { equals: 'Dr. House', mode: 'insensitive' },
          },
        },
        include: { doctors: true },
      });
      expect(result).toEqual({
        status: 'DOCTOR_NOT_AVAILABLE',
        message: 'Doctor "Dr. House" does not offer "Consultation".',
      });
      expect(mockDb.bookings.create).not.toHaveBeenCalled();
    });

    it('should confirm booking when doctor is available without conflicts (happy path)', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]); // No existing bookings
      mockDb.bookings.create.mockResolvedValue({
        id: 'booking-999',
      });

      const result = await service.createBooking(defaultParams);

      expect(result).toEqual({
        status: 'CONFIRMED',
        bookingId: 'booking-999',
        doctorName: 'Alice',
        date: '2026-08-25',
        time: '10:00',
      });
      expect(mockDb.bookings.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-123',
          doctor_id: 'doc-1',
          service_id: 'svc-1',
          start_time: new Date('2026-08-25T10:00:00'),
          end_time: new Date('2026-08-25T10:30:00'),
          client_phone: '+1234567890',
        },
      });
    });

    it('should return UNAVAILABLE with OUTSIDE_HOURS and alternatives when requested slot is outside doctor working hours', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      // Doctor works 09:00 - 12:00 on Tuesday, 09:00 - 17:00 on Wednesday
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '12:00',
        },
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);

      // Client requested 15:00 on Tuesday (outside working hours)
      const result = await service.createBooking({
        ...defaultParams,
        time: '15:00',
      });

      expect(result.status).toBe('UNAVAILABLE');
      if (result.status === 'UNAVAILABLE') {
        expect(result.reason).toBe('OUTSIDE_HOURS');
        expect(result.date).toBe('2026-08-25');
        expect(result.time).toBe('15:00');
        expect(result.nextDay).toBe('2026-08-26');
        expect(result.alternatives.length).toBeGreaterThan(0);
        expect(result.alternatives[0]).toContain('Dr. Alice: 09:00, 09:30, 10:00 (2026-08-25)');
        expect(result.alternatives[1]).toContain('Dr. Alice: 09:00, 09:30, 10:00 (2026-08-26)');
      }
      expect(mockDb.bookings.create).not.toHaveBeenCalled();
    });

    it('should return UNAVAILABLE with ALREADY_BOOKED and alternatives when slot is booked', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '11:00',
        },
      ]);
      // Slot 10:00-10:30 is already booked
      mockDb.$queryRaw.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          start_time: new Date('2026-08-25T10:00:00'),
          end_time: new Date('2026-08-25T10:30:00'),
        },
      ]);

      const result = await service.createBooking(defaultParams);

      expect(result.status).toBe('UNAVAILABLE');
      if (result.status === 'UNAVAILABLE') {
        expect(result.reason).toBe('ALREADY_BOOKED');
        expect(result.date).toBe('2026-08-25');
        expect(result.time).toBe('10:00');
        expect(result.alternatives).toEqual([
          'Dr. Alice: 09:00, 09:30, 10:30 (2026-08-25)',
        ]);
      }
      expect(mockDb.bookings.create).not.toHaveBeenCalled();
    });

    it('should select an available doctor when one is booked but another is free', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
        {
          doctor_id: 'doc-2',
          doctors: { name: 'Bob' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
        {
          doctor_id: 'doc-2',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      // Dr. Alice has a conflict at 10:00, Dr. Bob is free
      mockDb.$queryRaw.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          start_time: new Date('2026-08-25T10:00:00'),
          end_time: new Date('2026-08-25T10:30:00'),
        },
      ]);
      mockDb.bookings.create.mockResolvedValue({
        id: 'booking-bob-1',
      });

      const result = await service.createBooking(defaultParams);

      expect(result).toEqual({
        status: 'CONFIRMED',
        bookingId: 'booking-bob-1',
        doctorName: 'Bob',
        date: '2026-08-25',
        time: '10:00',
      });
      expect(mockDb.bookings.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-123',
          doctor_id: 'doc-2',
          service_id: 'svc-1',
          start_time: new Date('2026-08-25T10:00:00'),
          end_time: new Date('2026-08-25T10:30:00'),
          client_phone: '+1234567890',
        },
      });
    });

    it('should select an available doctor when one does not work at requested time but another does', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
        {
          doctor_id: 'doc-2',
          doctors: { name: 'Bob' },
        },
      ]);
      // Dr. Alice works 09:00-12:00, Dr. Bob works 12:00-18:00
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '12:00',
        },
        {
          doctor_id: 'doc-2',
          day: 'TUESDAY',
          start_time: '12:00',
          end_time: '18:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);
      mockDb.bookings.create.mockResolvedValue({
        id: 'booking-bob-2',
      });

      const result = await service.createBooking({
        ...defaultParams,
        time: '14:00',
      });

      expect(result).toEqual({
        status: 'CONFIRMED',
        bookingId: 'booking-bob-2',
        doctorName: 'Bob',
        date: '2026-08-25',
        time: '14:00',
      });
      expect(mockDb.bookings.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            doctor_id: 'doc-2',
            start_time: new Date('2026-08-25T14:00:00'),
          }),
        }),
      );
    });

    it('should fall back to alternatives when database booking creation throws due to race condition', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '12:00',
        },
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '12:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);
      const exclusionError = new Error(
        'exclusion constraint conflict: overlapping booking',
      );
      (exclusionError as any).code = '23P01';
      mockDb.bookings.create.mockRejectedValue(exclusionError);

      const result = await service.createBooking(defaultParams);

      expect(mockDb.bookings.create).toHaveBeenCalled();
      expect(result.status).toBe('UNAVAILABLE');
      if (result.status === 'UNAVAILABLE') {
        expect(result.reason).toBe('ALREADY_BOOKED');
        expect(result.date).toBe('2026-08-25');
        expect(result.time).toBe('10:00');
        expect(result.alternatives.length).toBeGreaterThan(0);
        expect(result.alternatives[0]).toContain('Dr. Alice:');
      }
    });

    it('should create booking without scheduling reminders inline', async () => {
      mockDb.services.findFirst.mockResolvedValue(mockServiceRow);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'TUESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);
      mockDb.bookings.create.mockResolvedValue({
        id: 'booking-direct',
        start_time: new Date('2026-08-25T10:00:00'),
      });

      const result = await service.createBooking(defaultParams);

      expect(result.status).toBe('CONFIRMED');
      expect(mockReminderQueue.addJob).not.toHaveBeenCalled();
      expect(mockDb.bookings.update).not.toHaveBeenCalled();
    });
  });

  describe('createReminders', () => {
    const tenantId = 'tenant-123';
    const bookingId = 'booking-123';
    const startTime = new Date('2026-08-25T10:00:00');

    it('should schedule both 24h and 1h reminders when booking is more than 24h in the future', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-20T10:00:00.000Z'));

      mockReminderQueue.addJob
        .mockResolvedValueOnce({ id: 'job-24h' })
        .mockResolvedValueOnce({ id: 'job-1h' });

      await service.createReminders(tenantId, startTime, bookingId);

      expect(mockReminderQueue.addJob).toHaveBeenCalledTimes(2);
      expect(mockTenantTransaction.run).toHaveBeenCalledWith(
        tenantId,
        expect.any(Function),
      );
      expect(mockTx.bookings.update).toHaveBeenCalledWith({
        where: { id: bookingId },
        data: {
          reminder_24h_job_id: 'job-24h',
          reminder_1h_job_id: 'job-1h',
        },
      });

      jest.useRealTimers();
    });

    it('should schedule only 1h reminder when booking is less than 24h away but more than 1h', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-25T07:00:00'));

      mockReminderQueue.addJob.mockResolvedValueOnce({ id: 'job-1h-only' });

      await service.createReminders(tenantId, startTime, bookingId);

      expect(mockReminderQueue.addJob).toHaveBeenCalledTimes(1);
      expect(mockReminderQueue.addJob).toHaveBeenCalledWith(
        bookingId,
        new Date('2026-08-25T09:00:00'),
      );
      expect(mockTx.bookings.update).toHaveBeenCalledWith({
        where: { id: bookingId },
        data: {
          reminder_1h_job_id: 'job-1h-only',
        },
      });

      jest.useRealTimers();
    });

    it('should not schedule reminders when booking is in the past or less than 1h in future', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-25T09:30:00'));

      await service.createReminders(tenantId, startTime, bookingId);

      expect(mockReminderQueue.addJob).not.toHaveBeenCalled();
      expect(mockTx.bookings.update).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should catch and log error if reminder queue throws an error without bubbling up', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-20T10:00:00.000Z'));

      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      mockReminderQueue.addJob.mockRejectedValue(
        new Error('Redis connection down'),
      );

      await expect(
        service.createReminders(tenantId, startTime, bookingId),
      ).resolves.not.toThrow();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to schedule reminders for booking booking-123: Redis connection down'),
      );

      jest.useRealTimers();
    });
  });

  describe('cancelReminder', () => {
    it('should call reminderQueue.removeJob when jobId is provided', async () => {
      await service.cancelReminder('job-123');
      expect(mockReminderQueue.removeJob).toHaveBeenCalledWith('job-123');
    });

    it('should do nothing when jobId is null or undefined', async () => {
      await service.cancelReminder(null);
      await service.cancelReminder(undefined);
      expect(mockReminderQueue.removeJob).not.toHaveBeenCalled();
    });

    it('should catch and log error without throwing when removeJob fails', async () => {
      const loggerWarnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});

      mockReminderQueue.removeJob.mockRejectedValueOnce(
        new Error('Redis error'),
      );
      await expect(service.cancelReminder('job-error')).resolves.not.toThrow();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove reminder job job-error: Redis error'),
      );
    });
  });

  describe('updateBooking', () => {
    const defaultParams = {
      tenantId: 'tenant-123',
      clientPhone: '+1234567890',
      date: '2026-08-26', // Wednesday
      time: '11:00',
    };

    const mockExistingBooking = {
      id: 'existing-booking-1',
      tenant_id: 'tenant-123',
      doctor_id: 'doc-1',
      service_id: 'svc-1',
      client_phone: '+1234567890',
      start_time: new Date('2026-08-25T10:00:00'),
      end_time: new Date('2026-08-25T10:30:00'),
      status: 'confirmed',
      reminder_24h_job_id: 'job-old-24h',
      reminder_1h_job_id: 'job-old-1h',
      services: {
        id: 'svc-1',
        name: 'Consultation',
        duration_minutes: 30,
      },
      doctors: {
        id: 'doc-1',
        name: 'Alice',
      },
    };

    it('should return BOOKING_NOT_FOUND when no active booking exists for client', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(null);

      const result = await service.updateBooking(defaultParams);

      expect(mockDb.bookings.findFirst).toHaveBeenCalledWith({
        where: {
          client_phone: '+1234567890',
          status: 'confirmed',
          end_time: { gte: expect.any(Date) },
        },
        orderBy: {
          start_time: 'asc',
        },
        include: {
          services: true,
          doctors: true,
        },
      });
      expect(result).toEqual({
        status: 'BOOKING_NOT_FOUND',
        message: 'No active booking found to update.',
      });
    });

    it('should return BOOKING_NOT_FOUND when specific bookingId is not found', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(null);

      const result = await service.updateBooking({
        ...defaultParams,
        bookingId: 'non-existent-id',
      });

      expect(mockDb.bookings.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'non-existent-id',
          client_phone: '+1234567890',
          status: { not: 'cancelled' },
        },
        include: {
          services: true,
          doctors: true,
        },
      });
      expect(result).toEqual({
        status: 'BOOKING_NOT_FOUND',
        message: 'No active booking found to update.',
      });
    });

    it('should return SERVICE_NOT_FOUND when changing to a non-existent service', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.services.findFirst.mockResolvedValue(null);

      const result = await service.updateBooking({
        ...defaultParams,
        serviceName: 'Unknown Service',
      });

      expect(result).toEqual({
        status: 'SERVICE_NOT_FOUND',
        message: 'Service "Unknown Service" not found.',
      });
    });

    it('should return DOCTOR_NOT_AVAILABLE when requested doctor does not offer service', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.doctor_services.findMany.mockResolvedValue([]);

      const result = await service.updateBooking({
        ...defaultParams,
        doctorName: 'Dr. House',
      });

      expect(result).toEqual({
        status: 'DOCTOR_NOT_AVAILABLE',
        message: 'Doctor "Dr. House" does not offer "Consultation".',
      });
    });

    it('should update booking successfully on happy path (with automatic active booking lookup)', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
        {
          doctor_id: 'doc-1',
          day: 'THURSDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);
      mockDb.bookings.update.mockResolvedValue({
        ...mockExistingBooking,
        start_time: new Date('2026-08-26T11:00:00'),
        end_time: new Date('2026-08-26T11:30:00'),
      });

      const result = await service.updateBooking(defaultParams);

      expect(result).toEqual({
        status: 'UPDATED',
        bookingId: 'existing-booking-1',
        doctorName: 'Alice',
        serviceName: 'Consultation',
        date: '2026-08-26',
        time: '11:00',
        oldReminder24hJobId: 'job-old-24h',
        oldReminder1hJobId: 'job-old-1h',
      });
      expect(mockDb.bookings.update).toHaveBeenCalledWith({
        where: { id: 'existing-booking-1' },
        data: {
          doctor_id: 'doc-1',
          service_id: 'svc-1',
          start_time: new Date('2026-08-26T11:00:00'),
          end_time: new Date('2026-08-26T11:30:00'),
          status: 'confirmed',
          updated_at: expect.any(Date),
          reminder_24h_job_id: null,
          reminder_1h_job_id: null,
        },
      });
    });

    it('should update booking with new service and new doctor', async () => {
      const mockNewService = {
        id: 'svc-2',
        name: 'Teeth Cleaning',
        duration_minutes: 45,
      };
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.services.findFirst.mockResolvedValue(mockNewService);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-2',
          doctors: { name: 'Bob' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-2',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);
      mockDb.bookings.update.mockResolvedValue({
        id: 'existing-booking-1',
        doctor_id: 'doc-2',
        service_id: 'svc-2',
      });

      const result = await service.updateBooking({
        ...defaultParams,
        bookingId: 'existing-booking-1',
        serviceName: 'Teeth Cleaning',
        doctorName: 'Bob',
      });

      expect(result).toEqual({
        status: 'UPDATED',
        bookingId: 'existing-booking-1',
        doctorName: 'Bob',
        serviceName: 'Teeth Cleaning',
        date: '2026-08-26',
        time: '11:00',
        oldReminder24hJobId: 'job-old-24h',
        oldReminder1hJobId: 'job-old-1h',
      });
      expect(mockDb.bookings.update).toHaveBeenCalledWith({
        where: { id: 'existing-booking-1' },
        data: {
          doctor_id: 'doc-2',
          service_id: 'svc-2',
          start_time: new Date('2026-08-26T11:00:00'),
          end_time: new Date('2026-08-26T11:45:00'),
          status: 'confirmed',
          updated_at: expect.any(Date),
          reminder_24h_job_id: null,
          reminder_1h_job_id: null,
        },
      });
    });

    it('should return UNAVAILABLE with OUTSIDE_HOURS and alternatives when outside doctor working hours', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '12:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);

      const result = await service.updateBooking({
        ...defaultParams,
        time: '15:00',
      });

      expect(result.status).toBe('UNAVAILABLE');
      if (result.status === 'UNAVAILABLE') {
        expect(result.reason).toBe('OUTSIDE_HOURS');
        expect(result.date).toBe('2026-08-26');
        expect(result.time).toBe('15:00');
        expect(result.serviceName).toBe('Consultation');
        expect(result.alternatives.length).toBeGreaterThan(0);
      }
      expect(mockDb.bookings.update).not.toHaveBeenCalled();
    });

    it('should return UNAVAILABLE with ALREADY_BOOKED and alternatives when slot has conflict', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          start_time: new Date('2026-08-26T11:00:00'),
          end_time: new Date('2026-08-26T11:30:00'),
        },
      ]);

      const result = await service.updateBooking(defaultParams);

      expect(result.status).toBe('UNAVAILABLE');
      if (result.status === 'UNAVAILABLE') {
        expect(result.reason).toBe('ALREADY_BOOKED');
        expect(result.date).toBe('2026-08-26');
        expect(result.time).toBe('11:00');
        expect(result.alternatives).toEqual([
          'Dr. Alice: 09:00, 09:30, 10:00 (2026-08-26)',
        ]);
      }
      expect(mockDb.bookings.update).not.toHaveBeenCalled();
    });

    it('should retry with next available doctor when DB update fails due to race condition', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockExistingBooking);
      mockDb.doctor_services.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          doctors: { name: 'Alice' },
        },
        {
          doctor_id: 'doc-2',
          doctors: { name: 'Bob' },
        },
      ]);
      mockDb.doctor_hours.findMany.mockResolvedValue([
        {
          doctor_id: 'doc-1',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
        {
          doctor_id: 'doc-2',
          day: 'WEDNESDAY',
          start_time: '09:00',
          end_time: '17:00',
        },
      ]);
      mockDb.$queryRaw.mockResolvedValue([]);

      const exclusionError = new Error('exclusion constraint conflict');
      (exclusionError as any).code = '23P01';
      mockDb.bookings.update
        .mockRejectedValueOnce(exclusionError)
        .mockResolvedValueOnce({
          ...mockExistingBooking,
          doctor_id: 'doc-2',
        });

      const result = await service.updateBooking(defaultParams);

      expect(result).toEqual({
        status: 'UPDATED',
        bookingId: 'existing-booking-1',
        doctorName: 'Bob',
        serviceName: 'Consultation',
        date: '2026-08-26',
        time: '11:00',
        oldReminder24hJobId: 'job-old-24h',
        oldReminder1hJobId: 'job-old-1h',
      });
      expect(mockDb.bookings.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('cancelBooking', () => {
    const defaultParams = {
      tenantId: 'tenant-123',
      clientPhone: '+1234567890',
    };

    const mockActiveBooking = {
      id: 'active-booking-1',
      tenant_id: 'tenant-123',
      doctor_id: 'doc-1',
      service_id: 'svc-1',
      client_phone: '+1234567890',
      start_time: new Date('2026-08-25T10:00:00'),
      end_time: new Date('2026-08-25T10:30:00'),
      status: 'confirmed',
      reminder_24h_job_id: 'job-24h-1',
      reminder_1h_job_id: 'job-1h-1',
      services: {
        id: 'svc-1',
        name: 'Consultation',
      },
      doctors: {
        id: 'doc-1',
        name: 'Alice',
      },
    };

    it('should return BOOKING_NOT_FOUND when no active booking exists for client', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(null);

      const result = await service.cancelBooking(defaultParams);

      expect(mockDb.bookings.findFirst).toHaveBeenCalledWith({
        where: {
          client_phone: '+1234567890',
          status: 'confirmed',
          end_time: { gte: expect.any(Date) },
        },
        orderBy: {
          start_time: 'asc',
        },
        include: {
          services: true,
          doctors: true,
        },
      });
      expect(result).toEqual({
        status: 'BOOKING_NOT_FOUND',
        message: 'No active booking found to cancel.',
      });
      expect(mockDb.bookings.update).not.toHaveBeenCalled();
    });

    it('should return BOOKING_NOT_FOUND when specific bookingId does not exist or is already cancelled', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(null);

      const result = await service.cancelBooking({
        ...defaultParams,
        bookingId: 'cancelled-or-missing-id',
      });

      expect(mockDb.bookings.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'cancelled-or-missing-id',
          client_phone: '+1234567890',
          status: { not: 'cancelled' },
        },
        include: {
          services: true,
          doctors: true,
        },
      });
      expect(result).toEqual({
        status: 'BOOKING_NOT_FOUND',
        message: 'No active booking found to cancel.',
      });
      expect(mockDb.bookings.update).not.toHaveBeenCalled();
    });

    it('should cancel booking and update status to cancelled by phone number lookup', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockActiveBooking);
      mockDb.bookings.update.mockResolvedValue({
        ...mockActiveBooking,
        status: 'cancelled',
      });

      const result = await service.cancelBooking(defaultParams);

      expect(mockDb.bookings.update).toHaveBeenCalledWith({
        where: { id: 'active-booking-1' },
        data: {
          status: 'cancelled',
          updated_at: expect.any(Date),
          reminder_24h_job_id: null,
          reminder_1h_job_id: null,
        },
      });
      expect(result).toEqual({
        status: 'CANCELLED',
        bookingId: 'active-booking-1',
        doctorName: 'Alice',
        serviceName: 'Consultation',
        date: '2026-08-25',
        time: '10:00',
        reminder24hJobId: 'job-24h-1',
        reminder1hJobId: 'job-1h-1',
      });
    });

    it('should cancel booking when specific bookingId is provided', async () => {
      mockDb.bookings.findFirst.mockResolvedValue(mockActiveBooking);
      mockDb.bookings.update.mockResolvedValue({
        ...mockActiveBooking,
        status: 'cancelled',
      });

      const result = await service.cancelBooking({
        ...defaultParams,
        bookingId: 'active-booking-1',
      });

      expect(mockDb.bookings.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'active-booking-1',
          client_phone: '+1234567890',
          status: { not: 'cancelled' },
        },
        include: {
          services: true,
          doctors: true,
        },
      });
      expect(result.status).toBe('CANCELLED');
    });
  });
});
