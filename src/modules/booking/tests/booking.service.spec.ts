import { Test, TestingModule } from '@nestjs/testing';
import { BookingService } from '../booking.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';

describe('BookingService', () => {
  let service: BookingService;

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
    },
    $queryRaw: jest.fn(),
  };

  const mockPrismaService = {
    get db() {
      return mockDb;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
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
  });
});
