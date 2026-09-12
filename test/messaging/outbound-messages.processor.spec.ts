import { OutboundMessagesProcessor } from '../../src/modules/messaging/queue/outbound-messages.processor';
import { WhatsappClient } from '../../src/modules/whatsapp/whatsapp.client';
import { WhatsappSendError } from '../../src/modules/whatsapp/whatsapp.errors';
import { TenantTransaction } from '../../common/tenant-context/tenant-transaction';
import { OutboundSweeperService } from '../../src/modules/messaging/queue/outbound-sweeper.service';
import { UnrecoverableError } from 'bullmq';

describe('OutboundMessagesProcessor', () => {
  let processor: OutboundMessagesProcessor;
  let mockWhatsappClient: any;
  let mockTenantTransaction: any;
  let mockSweeperService: any;
  let mockRedis: any;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      messages: {
        updateMany: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      conversations: {
        updateMany: jest.fn(),
      },
    };

    mockWhatsappClient = {
      sendText: jest.fn(),
    };

    mockTenantTransaction = {
      run: jest.fn().mockImplementation((tenantId: string, fn: (tx: any) => Promise<any>) =>
        fn(mockTx),
      ),
    };

    mockSweeperService = {
      runSweep: jest.fn().mockResolvedValue(0),
    };

    mockRedis = {
      getdel: jest.fn().mockResolvedValue(null),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    };

    processor = new OutboundMessagesProcessor(
      mockWhatsappClient as unknown as WhatsappClient,
      mockTenantTransaction as unknown as TenantTransaction,
      mockSweeperService as unknown as OutboundSweeperService,
      mockRedis as any,
    );
  });

  describe('Sweeper Job Handling', () => {
    it('executes sweeperService.runSweep when job.name is sweep', async () => {
      const job: any = { name: 'sweep', data: {} };
      await processor.process(job);

      expect(mockSweeperService.runSweep).toHaveBeenCalled();
      expect(mockTenantTransaction.run).not.toHaveBeenCalled();
    });
  });

  describe('Phase A: Claim & Mutual Exclusion', () => {
    it('skips processing if claim update returns 0 rows (already claimed/sent/dead)', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 0 });

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-1' },
      };

      await processor.process(job);

      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'm-1',
          status: { in: ['pending_dispatch', 'dispatch_failed'] },
          dispatch_attempts: { lt: 3 },
        },
        data: {
          status: 'sending',
          dispatch_attempts: { increment: 1 },
          dispatched_at: expect.any(Date),
        },
      });
      expect(mockWhatsappClient.sendText).not.toHaveBeenCalled();
    });

    it('suppresses AI reply if conversation status is human_active', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-ai-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'I can help you',
        conversations: { id: 'c-1', client_phone: '+123', status: 'human_active', version: 1 },
      });

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-ai-1' },
      };

      await processor.process(job);

      expect(mockTx.messages.update).toHaveBeenCalledWith({
        where: { id: 'm-ai-1' },
        data: {
          status: 'dead',
          last_error: 'suppressed: conversation in human_active',
        },
      });
      expect(mockWhatsappClient.sendText).not.toHaveBeenCalled();
    });

    it('suppresses AI reply if conversation status is needs_human', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-ai-2',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'Draft reply',
        conversations: { id: 'c-1', client_phone: '+123', status: 'needs_human', version: 2 },
      });

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-ai-2' },
      };

      await processor.process(job);

      expect(mockTx.messages.update).toHaveBeenCalledWith({
        where: { id: 'm-ai-2' },
        data: {
          status: 'dead',
          last_error: 'suppressed: conversation in needs_human',
        },
      });
      expect(mockWhatsappClient.sendText).not.toHaveBeenCalled();
    });

    it('allows escalation holding reply to send when conversation is in needs_human', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-holding-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'A staff member will assist you shortly.',
        dispatch_attempts: 1,
        conversations: { id: 'c-1', client_phone: '+123', status: 'needs_human', version: 2 },
        messages: { status: 'escalated' }, // Triggering message was escalated
      });
      mockWhatsappClient.sendText.mockResolvedValue({ wamid: 'wamid.holding.1' });

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-holding-1' },
      };

      await processor.process(job);

      expect(mockWhatsappClient.sendText).toHaveBeenCalled();
      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-holding-1', status: 'sending' },
        data: {
          status: 'sent',
          wa_message_id: 'wamid.holding.1',
          last_error: null,
        },
      });
    });

    it('defers owner reply if an earlier owner reply in the same conversation is unresolved', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-owner-2',
        conversation_id: 'c-1',
        sender: 'owner',
        content: 'Second message',
        created_at: new Date('2026-09-10T12:05:00Z'),
        conversations: { id: 'c-1', client_phone: '+123', status: 'human_active', version: 2 },
      });
      // Prior owner message exists
      mockTx.messages.findFirst.mockResolvedValue({ id: 'm-owner-1' });

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-owner-2' },
      };

      await expect(processor.process(job)).rejects.toThrow('PRIOR_OWNER_REPLY_PENDING');

      // Restored to pending_dispatch and attempts decremented
      expect(mockTx.messages.update).toHaveBeenCalledWith({
        where: { id: 'm-owner-2' },
        data: {
          status: 'pending_dispatch',
          dispatch_attempts: { decrement: 1 },
        },
      });
      expect(mockWhatsappClient.sendText).not.toHaveBeenCalled();
    });
  });

  describe('Phase B: Send & Error Handling', () => {
    it('handles non-retryable WhatsappSendError by marking message dead and throwing UnrecoverableError', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'Hello',
        dispatch_attempts: 1,
        conversations: { id: 'c-1', client_phone: '+123', status: 'ai_active', version: 1 },
      });

      mockWhatsappClient.sendText.mockRejectedValue(
        new WhatsappSendError('190', false, 'Token revoked'),
      );

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-1' },
      };

      await expect(processor.process(job)).rejects.toThrow(UnrecoverableError);

      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1', status: 'sending' },
        data: {
          status: 'dead',
          last_error: expect.stringContaining('Token revoked'),
        },
      });
    });

    it('handles retryable error by marking dispatch_failed when attempts < 3 and rethrowing for BullMQ retry', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'Hello',
        dispatch_attempts: 1, // Attempt 1 of 3
        conversations: { id: 'c-1', client_phone: '+123', status: 'ai_active', version: 1 },
      });

      const retryableError = new WhatsappSendError('503', true, 'Service Unavailable');
      mockWhatsappClient.sendText.mockRejectedValue(retryableError);

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-1' },
      };

      await expect(processor.process(job)).rejects.toThrow(retryableError);

      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1', status: 'sending' },
        data: {
          status: 'dispatch_failed',
          last_error: expect.stringContaining('Service Unavailable'),
        },
      });
    });

    it('marks message dead and throws UnrecoverableError when retryable error exhausts 3 attempts', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'Hello',
        dispatch_attempts: 3, // 3rd attempt exhausted!
        conversations: { id: 'c-1', client_phone: '+123', status: 'ai_active', version: 1 },
      });

      mockWhatsappClient.sendText.mockRejectedValue(
        new WhatsappSendError('503', true, 'Service Unavailable'),
      );

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-1' },
      };

      await expect(processor.process(job)).rejects.toThrow(UnrecoverableError);

      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1', status: 'sending' },
        data: {
          status: 'dead',
          last_error: expect.stringContaining('Service Unavailable'),
        },
      });
    });
  });

  describe('Phase C: Record & Auto-Resume', () => {
    it('records sent status and wa_message_id on successful send', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'Welcome',
        dispatch_attempts: 1,
        conversations: { id: 'c-1', client_phone: '+123', status: 'ai_active', version: 1 },
      });
      mockWhatsappClient.sendText.mockResolvedValue({ wamid: 'wamid.123' });

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-1' },
      };

      await processor.process(job);

      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1', status: 'sending' },
        data: {
          status: 'sent',
          wa_message_id: 'wamid.123',
          last_error: null,
        },
      });
    });

    it('resolves early receipt from Redis immediately if present', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-1',
        conversation_id: 'c-1',
        sender: 'ai',
        content: 'Welcome',
        dispatch_attempts: 1,
        conversations: { id: 'c-1', client_phone: '+123', status: 'ai_active', version: 1 },
      });
      mockWhatsappClient.sendText.mockResolvedValue({ wamid: 'wamid.123' });

      mockRedis.getdel.mockResolvedValue(
        JSON.stringify({
          status: 'delivered',
          delivered_at: '2026-09-10T12:00:00.000Z',
          error: null,
        }),
      );

      const job: any = {
        name: 'send',
        data: { tenantId: 't-1', messageId: 'm-1' },
      };

      await processor.process(job);

      expect(mockTx.messages.updateMany).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: {
          status: 'delivered',
          delivered_at: new Date('2026-09-10T12:00:00.000Z'),
          last_error: null,
        },
      });
    });

    it('performs CAS auto-resume for owner reply when resumeAi is true and expectedVersion matches', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-owner-1',
        conversation_id: 'c-1',
        sender: 'owner',
        content: 'Your appointment is confirmed',
        dispatch_attempts: 1,
        conversations: { id: 'c-1', client_phone: '+123', status: 'human_active', version: 2 },
      });
      mockTx.messages.findFirst.mockResolvedValue(null); // No older owner reply
      mockTx.messages.count.mockResolvedValue(0); // No pending owner replies
      mockTx.conversations.updateMany.mockResolvedValue({ count: 1 });

      mockWhatsappClient.sendText.mockResolvedValue({ wamid: 'wamid.owner.1' });

      const job: any = {
        name: 'send',
        data: {
          tenantId: 't-1',
          messageId: 'm-owner-1',
          expectedVersion: 2,
          resumeAi: true,
        },
      };

      await processor.process(job);

      expect(mockTx.conversations.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'c-1',
          status: 'human_active',
          version: 2,
        },
        data: {
          status: 'ai_active',
          version: { increment: 1 },
          updated_at: expect.any(Date),
        },
      });
    });

    it('skips auto-resume if another owner reply is still pending', async () => {
      mockTx.messages.updateMany.mockResolvedValue({ count: 1 });
      mockTx.messages.findUniqueOrThrow.mockResolvedValue({
        id: 'm-owner-1',
        conversation_id: 'c-1',
        sender: 'owner',
        content: 'Your appointment is confirmed',
        dispatch_attempts: 1,
        conversations: { id: 'c-1', client_phone: '+123', status: 'human_active', version: 2 },
      });
      mockTx.messages.findFirst.mockResolvedValue(null);
      mockTx.messages.count.mockResolvedValue(1); // 1 other owner reply still pending!

      mockWhatsappClient.sendText.mockResolvedValue({ wamid: 'wamid.owner.1' });

      const job: any = {
        name: 'send',
        data: {
          tenantId: 't-1',
          messageId: 'm-owner-1',
          expectedVersion: 2,
          resumeAi: true,
        },
      };

      await processor.process(job);

      expect(mockTx.conversations.updateMany).not.toHaveBeenCalled();
    });
  });
});
