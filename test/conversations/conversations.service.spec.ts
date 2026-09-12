import { NotFoundException } from '@nestjs/common';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantTransaction } from '../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from '../../src/modules/messaging/queue/outbound-messages.queue';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let mockPrismaService: any;
  let mockTenantTransaction: any;
  let mockOutboundMessagesQueue: any;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      conversations: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      messages: {
        create: jest.fn(),
      },
    };

    mockPrismaService = {
      db: {
        messages: {
          findMany: jest.fn(),
        },
      },
    };

    mockTenantTransaction = {
      run: jest.fn().mockImplementation((tenantId: string, fn: (tx: any) => Promise<any>) => fn(mockTx)),
    };

    mockOutboundMessagesQueue = {
      addJob: jest.fn().mockResolvedValue(undefined),
    };

    service = new ConversationsService(
      mockPrismaService as unknown as PrismaService,
      mockTenantTransaction as unknown as TenantTransaction,
      mockOutboundMessagesQueue as unknown as OutboundMessagesQueue,
    );
  });

  describe('fetchRecentMessages', () => {
    it('queries messages excluding dead statuses and returns them chronologically (reversed)', async () => {
      const messagesDesc = [
        { id: '2', content: 'second message', created_at: new Date('2026-09-07T12:01:00Z') },
        { id: '1', content: 'first message', created_at: new Date('2026-09-07T12:00:00Z') },
      ];
      mockPrismaService.db.messages.findMany.mockResolvedValue([...messagesDesc]);

      const result = await service.fetchRecentMessages('tenant-1', 'conv-1', 10);

      expect(mockPrismaService.db.messages.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          conversation_id: 'conv-1',
          status: {
            notIn: ['dispatch_failed', 'dead', 'undeliverable'],
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      });
      // Should be reversed to chronological order
      expect(result).toEqual([messagesDesc[1], messagesDesc[0]]);
    });
  });

  describe('getConversations', () => {
    it('returns paginated conversations with totalPages and default page/limit', async () => {
      const mockItems = [{ id: 'conv-1', tenant_id: 'tenant-1' }];
      mockTx.conversations.findMany.mockResolvedValue(mockItems);
      mockTx.conversations.count.mockResolvedValue(25);

      const result = await service.getConversations('tenant-1', {});

      expect(mockTenantTransaction.run).toHaveBeenCalledWith('tenant-1', expect.any(Function));
      expect(mockTx.conversations.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        orderBy: { updated_at: 'desc' },
        skip: 0,
        take: 20,
        include: {
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      });
      expect(result).toEqual({
        items: mockItems,
        total: 25,
        page: 1,
        limit: 20,
        totalPages: 2,
      });
    });

    it('applies status filter and custom pagination when provided', async () => {
      mockTx.conversations.findMany.mockResolvedValue([]);
      mockTx.conversations.count.mockResolvedValue(0);

      await service.getConversations('tenant-1', {
        status: 'needs_human',
        page: 2,
        limit: 10,
      });

      expect(mockTx.conversations.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', status: 'needs_human' },
        orderBy: { updated_at: 'desc' },
        skip: 10,
        take: 10,
        include: {
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      });
    });
  });

  describe('getConversationById', () => {
    it('returns conversation if found and belongs to tenant', async () => {
      const mockConv = { id: 'conv-1', tenant_id: 'tenant-1', messages: [] };
      mockTx.conversations.findUnique.mockResolvedValue(mockConv);

      const result = await service.getConversationById('tenant-1', 'conv-1');

      expect(result).toEqual(mockConv);
      expect(mockTx.conversations.findUnique).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        include: {
          messages: {
            orderBy: { created_at: 'asc' },
          },
        },
      });
    });

    it('throws NotFoundException if conversation does not exist', async () => {
      mockTx.conversations.findUnique.mockResolvedValue(null);

      await expect(
        service.getConversationById('tenant-1', 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if conversation belongs to another tenant', async () => {
      mockTx.conversations.findUnique.mockResolvedValue({
        id: 'conv-1',
        tenant_id: 'other-tenant',
      });

      await expect(
        service.getConversationById('tenant-1', 'conv-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('replyToConversation', () => {
    it('creates message, sets status to ai_active (default resumeAi), increments version, and enqueues outbound job', async () => {
      const mockConv = { id: 'conv-1', tenant_id: 'tenant-1', version: 1 };
      mockTx.conversations.findUnique.mockResolvedValue(mockConv);
      mockTx.conversations.update.mockResolvedValue({ version: 2 });
      const mockMsg = { id: 'msg-1', content: 'Hello patient', sender: 'owner' };
      mockTx.messages.create.mockResolvedValue(mockMsg);

      const result = await service.replyToConversation('tenant-1', 'conv-1', {
        content: 'Hello patient',
      });

      expect(mockTx.messages.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          conversation_id: 'conv-1',
          sender: 'owner',
          content: 'Hello patient',
          status: 'pending_dispatch',
        },
      });

      expect(mockTx.conversations.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: {
          status: 'human_active',
          version: { increment: 1 },
          updated_at: expect.any(Date),
        },
        select: { version: true },
      });

      expect(mockOutboundMessagesQueue.addJob).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        messageId: 'msg-1',
        expectedVersion: 2,
        resumeAi: true,
      });

      expect(result).toEqual(mockMsg);
    });

    it('sets status to human_active when resumeAi is false', async () => {
      const mockConv = { id: 'conv-1', tenant_id: 'tenant-1', version: 1 };
      mockTx.conversations.findUnique.mockResolvedValue(mockConv);
      mockTx.conversations.update.mockResolvedValue({ version: 2 });
      const mockMsg = { id: 'msg-2', content: 'Wait here', sender: 'owner' };
      mockTx.messages.create.mockResolvedValue(mockMsg);

      await service.replyToConversation('tenant-1', 'conv-1', {
        content: 'Wait here',
        resumeAi: false,
      });

      expect(mockTx.conversations.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: {
          status: 'human_active',
          version: { increment: 1 },
          updated_at: expect.any(Date),
        },
        select: { version: true },
      });

      expect(mockOutboundMessagesQueue.addJob).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        messageId: 'msg-2',
        expectedVersion: 2,
        resumeAi: false,
      });
    });

    it('throws NotFoundException if conversation belongs to another tenant', async () => {
      mockTx.conversations.findUnique.mockResolvedValue({
        id: 'conv-1',
        tenant_id: 'other-tenant',
      });

      await expect(
        service.replyToConversation('tenant-1', 'conv-1', { content: 'Hi' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockTx.messages.create).not.toHaveBeenCalled();
      expect(mockOutboundMessagesQueue.addJob).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('updates status and increments version for valid conversation', async () => {
      mockTx.conversations.findUnique.mockResolvedValue({
        id: 'conv-1',
        tenant_id: 'tenant-1',
      });
      mockTx.conversations.update.mockResolvedValue({
        id: 'conv-1',
        status: 'human_active',
        version: 3,
      });

      const result = await service.updateStatus('tenant-1', 'conv-1', 'human_active');

      expect(mockTx.conversations.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: {
          status: 'human_active',
          version: { increment: 1 },
          updated_at: expect.any(Date),
        },
      });
      expect(result.status).toBe('human_active');
    });

    it('throws NotFoundException if conversation belongs to another tenant', async () => {
      mockTx.conversations.findUnique.mockResolvedValue({
        id: 'conv-1',
        tenant_id: 'other-tenant',
      });

      await expect(
        service.updateStatus('tenant-1', 'conv-1', 'ai_active'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
