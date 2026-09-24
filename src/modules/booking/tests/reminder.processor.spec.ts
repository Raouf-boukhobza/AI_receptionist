import { ReminderProcessor } from '../queue/reminder.processor';
import { TenantTransaction } from '../../../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from '../../messaging/queue/outbound-messages.queue';

describe('ReminderProcessor', () => {
  let processor: ReminderProcessor;
  let mockTenantTransaction: any;
  let mockOutboundMessagesQueue: any;
  let mockTx: any;

  const tenantId = 'tenant-1';
  const bookingId = 'booking-1';
  const futureStart = new Date(Date.now() + 25 * 60 * 60 * 1000);

  const baseBooking = () => ({
    id: bookingId,
    tenant_id: tenantId,
    client_phone: '213555123456',
    start_time: futureStart,
    status: 'confirmed',
    reminder_24h_job_id: 'job-1',
    reminder_1h_job_id: null,
    doctors: { name: 'Dr. Ahmed' },
    services: { name: 'Dental cleaning' },
  });

  beforeEach(() => {
    mockTx = {
      bookings: { findUnique: jest.fn() },
      conversations: { findFirst: jest.fn(), create: jest.fn() },
      messages: { create: jest.fn() },
    };

    mockTenantTransaction = {
      run: jest.fn().mockImplementation((tId: string, fn: (tx: any) => Promise<any>) => fn(mockTx)),
    };

    mockOutboundMessagesQueue = {
      addJob: jest.fn().mockResolvedValue(undefined),
    };

    processor = new ReminderProcessor(
      mockTenantTransaction as unknown as TenantTransaction,
      mockOutboundMessagesQueue as unknown as OutboundMessagesQueue,
    );
  });

  function job(jobId = 'job-1'): any {
    return { id: jobId, data: { bookingId, tenantId } };
  }

  it('skips when booking no longer exists', async () => {
    mockTx.bookings.findUnique.mockResolvedValue(null);

    await processor.process(job());

    expect(mockTx.messages.create).not.toHaveBeenCalled();
    expect(mockOutboundMessagesQueue.addJob).not.toHaveBeenCalled();
  });

  it('skips cancelled bookings', async () => {
    mockTx.bookings.findUnique.mockResolvedValue({ ...baseBooking(), status: 'cancelled' });

    await processor.process(job());

    expect(mockTx.messages.create).not.toHaveBeenCalled();
    expect(mockOutboundMessagesQueue.addJob).not.toHaveBeenCalled();
  });

  it('skips when the appointment already passed', async () => {
    mockTx.bookings.findUnique.mockResolvedValue({
      ...baseBooking(),
      start_time: new Date(Date.now() - 60_000),
    });

    await processor.process(job());

    expect(mockTx.messages.create).not.toHaveBeenCalled();
    expect(mockOutboundMessagesQueue.addJob).not.toHaveBeenCalled();
  });

  it('skips superseded jobs whose id no longer matches stored reminder ids', async () => {
    mockTx.bookings.findUnique.mockResolvedValue({
      ...baseBooking(),
      reminder_24h_job_id: 'job-newer',
      reminder_1h_job_id: null,
    });

    await processor.process(job('job-1'));

    expect(mockTx.messages.create).not.toHaveBeenCalled();
    expect(mockOutboundMessagesQueue.addJob).not.toHaveBeenCalled();
  });

  it('skips jobs with missing bookingId/tenantId', async () => {
    await processor.process({ id: 'job-x', data: {} } as any);

    expect(mockTenantTransaction.run).not.toHaveBeenCalled();
    expect(mockOutboundMessagesQueue.addJob).not.toHaveBeenCalled();
  });

  it('creates a system template message and enqueues it to outbound', async () => {
    mockTx.bookings.findUnique.mockResolvedValue(baseBooking());
    mockTx.conversations.findFirst.mockResolvedValue({ id: 'conv-1' });
    mockTx.messages.create.mockResolvedValue({ id: 'msg-rem-1' });

    await processor.process(job());

    expect(mockTx.bookings.findUnique).toHaveBeenCalledWith({
      where: { id: bookingId },
      include: {
        doctors: { select: { name: true } },
        services: { select: { name: true } },
      },
    });
    expect(mockTx.conversations.create).not.toHaveBeenCalled();
    expect(mockTx.messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: tenantId,
        conversation_id: 'conv-1',
        sender: 'system',
        status: 'pending_dispatch',
        template_name: 'appointment_reminder',
        template_params: expect.objectContaining({
          languageCode: 'en',
          bodyParams: expect.any(Array),
        }),
      }),
    });
    expect(mockOutboundMessagesQueue.addJob).toHaveBeenCalledWith({
      tenantId,
      messageId: 'msg-rem-1',
    });
  });

  it('creates the conversation when none exists', async () => {
    mockTx.bookings.findUnique.mockResolvedValue(baseBooking());
    mockTx.conversations.findFirst.mockResolvedValue(null);
    mockTx.conversations.create.mockResolvedValue({ id: 'conv-new' });
    mockTx.messages.create.mockResolvedValue({ id: 'msg-rem-2' });

    await processor.process(job());

    expect(mockTx.conversations.create).toHaveBeenCalledWith({
      data: {
        tenant_id: tenantId,
        client_phone: '213555123456',
        status: 'ai_active',
      },
    });
    expect(mockOutboundMessagesQueue.addJob).toHaveBeenCalledWith({
      tenantId,
      messageId: 'msg-rem-2',
    });
  });
});
