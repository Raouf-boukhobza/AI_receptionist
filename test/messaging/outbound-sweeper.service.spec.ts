import { OutboundSweeperService } from '../../src/modules/messaging/queue/outbound-sweeper.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTransaction } from '../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from '../../src/modules/messaging/queue/outbound-messages.queue';

describe('OutboundSweeperService', () => {
  let service: OutboundSweeperService;
  let mockPrismaService: any;
  let mockTenantTransaction: any;
  let mockQueue: any;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      messages: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
    };

    mockPrismaService = {
      rawClient: {
        tenants: {
          findMany: jest.fn(),
        },
      },
    };

    mockTenantTransaction = {
      run: jest.fn().mockImplementation((tenantId: string, fn: (tx: any) => Promise<any>) =>
        fn(mockTx),
      ),
    };

    mockQueue = {
      requeue: jest.fn().mockResolvedValue(undefined),
    };

    service = new OutboundSweeperService(
      mockPrismaService as unknown as PrismaService,
      mockTenantTransaction as unknown as TenantTransaction,
      mockQueue as unknown as OutboundMessagesQueue,
    );
  });

  it('runs sweep for all tenants with phone_number_id', async () => {
    mockPrismaService.rawClient.tenants.findMany.mockResolvedValue([
      { id: 'tenant-1' },
      { id: 'tenant-2' },
    ]);

    mockTx.messages.findMany
      .mockResolvedValueOnce([{ id: 'msg-1' }, { id: 'msg-2' }]) // tenant-1
      .mockResolvedValueOnce([{ id: 'msg-3' }]); // tenant-2

    const count = await service.runSweep();

    expect(count).toBe(3);
    expect(mockPrismaService.rawClient.tenants.findMany).toHaveBeenCalledWith({
      where: { phone_number_id: { not: null } },
      select: { id: true },
    });

    // Tenant 1 & Tenant 2 were both swept in TenantTransaction
    expect(mockTenantTransaction.run).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(mockTenantTransaction.run).toHaveBeenCalledWith('tenant-2', expect.any(Function));

    // Stale sends reset
    expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'sending',
        dispatched_at: { lt: expect.any(Date) },
        dispatch_attempts: { lt: 3 },
      },
      data: {
        status: 'dispatch_failed',
        last_error: 'Worker timeout: send lease expired',
      },
    });

    // Exhausted attempts marked dead
    expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['sending', 'dispatch_failed'] },
        dispatch_attempts: { gte: 3 },
      },
      data: {
        status: 'dead',
        last_error: 'Delivery attempts exhausted (3/3)',
      },
    });

    // Requeued messages
    expect(mockQueue.requeue).toHaveBeenCalledWith({ tenantId: 'tenant-1', messageId: 'msg-1' });
    expect(mockQueue.requeue).toHaveBeenCalledWith({ tenantId: 'tenant-1', messageId: 'msg-2' });
    expect(mockQueue.requeue).toHaveBeenCalledWith({ tenantId: 'tenant-2', messageId: 'msg-3' });
  });

  it('handles tenant failure gracefully without stopping other tenants', async () => {
    mockPrismaService.rawClient.tenants.findMany.mockResolvedValue([
      { id: 'tenant-fail' },
      { id: 'tenant-ok' },
    ]);

    mockTenantTransaction.run.mockImplementation((tenantId: string, fn: (tx: any) => Promise<any>) => {
      if (tenantId === 'tenant-fail') {
        return Promise.reject(new Error('DB Lock Timeout'));
      }
      return fn(mockTx);
    });

    mockTx.messages.findMany.mockResolvedValue([{ id: 'msg-ok-1' }]);

    const count = await service.runSweep();

    expect(count).toBe(1);
    expect(mockQueue.requeue).toHaveBeenCalledWith({ tenantId: 'tenant-ok', messageId: 'msg-ok-1' });
  });
});
