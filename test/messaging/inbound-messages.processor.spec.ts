import { InboundMessagesProcessor } from '../../src/modules/messaging/queue/inbound-messages.processor';
import { AgentService } from '../../src/modules/agent/agent.service';
import { TenantTransaction } from '../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from '../../src/modules/messaging/queue/outbound-messages.queue';
import { Job } from 'bullmq';
import { Prisma } from '../../generated/prisma/client';

describe('InboundMessagesProcessor (Worker & Concurrency)', () => {
  let processor: InboundMessagesProcessor;
  let mockAgentService: { getResponse: jest.Mock };
  let mockTenantTransaction: { run: jest.Mock };
  let mockOutboundQueue: { addJob: jest.Mock };
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      messages: {
        update: jest.fn(),
        findFirstOrThrow: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      conversations: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
    };

    mockAgentService = {
      getResponse: jest.fn(),
    };

    mockTenantTransaction = {
      run: jest.fn().mockImplementation((tenantId: string, fn: (tx: any) => Promise<any>) => fn(mockTx)),
    };

    mockOutboundQueue = {
      addJob: jest.fn().mockResolvedValue(undefined),
    };

    processor = new InboundMessagesProcessor(
      mockAgentService as unknown as AgentService,
      mockTenantTransaction as unknown as TenantTransaction,
      mockOutboundQueue as unknown as OutboundMessagesQueue,
    );
  });

  const fakeJob = {
    data: {
      tenantId: 'tenant-1',
      messageId: 'msg-inbound-1',
    },
  } as Job;

  it('skips LLM call if a reply already exists for this inbound message', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      conversations: { status: 'ai_active', version: 1 },
    });
    mockTx.messages.findFirst.mockResolvedValue({ id: 'msg-reply-existing' });

    await processor.process(fakeJob);

    expect(mockAgentService.getResponse).not.toHaveBeenCalled();
    expect(mockOutboundQueue.addJob).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      messageId: 'msg-reply-existing',
    });
  });

  it('skips AI generation if conversation is human_active (pre-LLM check)', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      conversation_id: 'conv-1',
      conversations: { id: 'conv-1', status: 'human_active', version: 2 },
    });
    mockTx.messages.findFirst.mockResolvedValue(null);

    await processor.process(fakeJob);

    expect(mockAgentService.getResponse).not.toHaveBeenCalled();
    expect(mockOutboundQueue.addJob).not.toHaveBeenCalled();
    expect(mockTx.messages.update).toHaveBeenCalledWith({
      where: { id: 'msg-inbound-1' },
      data: { status: 'received' },
    });
  });

  it('skips AI generation if conversation is needs_human (pre-LLM check)', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      conversation_id: 'conv-1',
      conversations: { id: 'conv-1', status: 'needs_human', version: 2 },
    });
    mockTx.messages.findFirst.mockResolvedValue(null);

    await processor.process(fakeJob);

    expect(mockAgentService.getResponse).not.toHaveBeenCalled();
    expect(mockOutboundQueue.addJob).not.toHaveBeenCalled();
  });

  it('generates normal AI reply, increments version, updates status to replied, and enqueues outbound', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      content: 'When are you open?',
      conversation_id: 'conv-1',
      conversations: {
        id: 'conv-1',
        status: 'ai_active',
        version: 1,
        client_phone: '+1234567890',
      },
    });
    mockTx.messages.findFirst.mockResolvedValue(null);

    mockAgentService.getResponse.mockResolvedValue({
      reply: 'We open at 9am.',
      escalated: false,
    });

    // Concurrency check inside transaction: version matches, still ai_active
    mockTx.conversations.findUniqueOrThrow.mockResolvedValue({
      id: 'conv-1',
      version: 1,
      status: 'ai_active',
    });

    mockTx.messages.create.mockResolvedValue({ id: 'msg-ai-reply-1' });

    await processor.process(fakeJob);

    expect(mockAgentService.getResponse).toHaveBeenCalledWith(
      'When are you open?',
      'tenant-1',
      'conv-1',
      '+1234567890',
    );

    expect(mockTx.messages.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        conversation_id: 'conv-1',
        sender: 'ai',
        status: 'pending_dispatch',
        reply_to_message_id: 'msg-inbound-1',
        content: 'We open at 9am.',
      },
    });

    expect(mockTx.conversations.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        version: { increment: 1 },
        updated_at: expect.any(Date),
      },
    });

    expect(mockTx.messages.update).toHaveBeenCalledWith({
      where: { id: 'msg-inbound-1' },
      data: { status: 'replied' },
    });

    expect(mockOutboundQueue.addJob).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      messageId: 'msg-ai-reply-1',
    });
  });

  it('handles AI escalation: updates conversation to needs_human and message to escalated', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      content: 'Do you do heart surgery?',
      conversation_id: 'conv-1',
      conversations: {
        id: 'conv-1',
        status: 'ai_active',
        version: 1,
        client_phone: '+1234567890',
      },
    });
    mockTx.messages.findFirst.mockResolvedValue(null);

    mockAgentService.getResponse.mockResolvedValue({
      reply: 'Let me check with our staff...',
      escalated: true,
      escalationReason: 'Knowledge base mismatch',
    });

    mockTx.conversations.findUniqueOrThrow.mockResolvedValue({
      id: 'conv-1',
      version: 1,
      status: 'ai_active',
    });

    mockTx.messages.create.mockResolvedValue({ id: 'msg-holding-reply' });

    await processor.process(fakeJob);

    expect(mockTx.conversations.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        status: 'needs_human',
        version: { increment: 1 },
        updated_at: expect.any(Date),
      },
    });

    expect(mockTx.messages.update).toHaveBeenCalledWith({
      where: { id: 'msg-inbound-1' },
      data: { status: 'escalated' },
    });

    expect(mockOutboundQueue.addJob).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      messageId: 'msg-holding-reply',
    });
  });

  it('optimistic locking: discards AI draft if staff took over during LLM thinking (version changed)', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      content: 'Can I book tomorrow?',
      conversation_id: 'conv-1',
      conversations: {
        id: 'conv-1',
        status: 'ai_active',
        version: 1,
        client_phone: '+1234567890',
      },
    });
    mockTx.messages.findFirst.mockResolvedValue(null);

    mockAgentService.getResponse.mockResolvedValue({
      reply: 'Sure, we have slots at 10am.',
      escalated: false,
    });

    // Staff intervened! Conversation version changed from 1 to 2 and status changed to human_active
    mockTx.conversations.findUniqueOrThrow.mockResolvedValue({
      id: 'conv-1',
      version: 2,
      status: 'human_active',
    });

    await processor.process(fakeJob);

    // AI message creation MUST be skipped
    expect(mockTx.messages.create).not.toHaveBeenCalled();
    // Outbound job MUST NOT be queued
    expect(mockOutboundQueue.addJob).not.toHaveBeenCalled();
    // Inbound message status should be reverted from 'processing' to 'received'
    expect(mockTx.messages.update).toHaveBeenCalledWith({
      where: { id: 'msg-inbound-1' },
      data: { status: 'received' },
    });
  });

  it('handles unique constraint race gracefully (P2002 error)', async () => {
    mockTx.messages.findFirstOrThrow.mockResolvedValue({
      id: 'msg-inbound-1',
      content: 'Hello',
      conversation_id: 'conv-1',
      conversations: {
        id: 'conv-1',
        status: 'ai_active',
        version: 1,
        client_phone: '+1234567890',
      },
    });
    mockTx.messages.findFirst.mockResolvedValueOnce(null); // initial check: no reply
    mockAgentService.getResponse.mockResolvedValue({ reply: 'Hi', escalated: false });

    mockTx.conversations.findUniqueOrThrow.mockResolvedValue({
      id: 'conv-1',
      version: 1,
      status: 'ai_active',
    });

    // Simulate P2002 unique constraint error on tx.messages.create
    const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    mockTx.messages.create.mockRejectedValue(p2002Error);
    mockTx.messages.findFirst.mockResolvedValueOnce({ id: 'msg-winner-reply' });

    await processor.process(fakeJob);

    expect(mockOutboundQueue.addJob).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      messageId: 'msg-winner-reply',
    });
  });
});
