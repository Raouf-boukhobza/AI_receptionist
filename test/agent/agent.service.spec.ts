import { AgentService } from '../../src/modules/agent/agent.service';
import { AgentGraphBuilder } from '../../src/modules/agent/graph/nodes/agent-graph.builder';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { messages } from '../../generated/prisma/client';
import { createBookingTool } from '../../src/modules/agent/graph/tools/booking.tool';

describe('AgentService (Stateless Execution & History)', () => {
  let agentService: AgentService;
  let mockGraph: { invoke: jest.Mock };
  let mockGraphBuilder: { buildGraph: jest.Mock };
  let mockConversationsService: { fetchRecentMessages: jest.Mock };

  beforeEach(() => {
    mockGraph = { invoke: jest.fn() };
    mockGraphBuilder = { buildGraph: jest.fn().mockReturnValue(mockGraph) };
    mockConversationsService = { fetchRecentMessages: jest.fn().mockResolvedValue([]) };

    agentService = new AgentService(
      mockGraphBuilder as unknown as AgentGraphBuilder,
      mockConversationsService as unknown as ConversationsService,
    );
  });

  it('fetches recent history from ConversationsService and formats messages', async () => {
    const fakeHistory: Partial<messages>[] = [
      { id: '1', sender: 'client', content: 'Do you offer teeth cleaning?' } as messages,
      { id: '2', sender: 'owner', content: 'Yes, we do teeth cleaning for 5000 DZD.' } as messages,
    ];
    mockConversationsService.fetchRecentMessages.mockResolvedValue(fakeHistory);

    mockGraph.invoke.mockResolvedValue({
      messages: [new AIMessage('Would you like to book an appointment?')],
    });

    const result = await agentService.getResponse(
      'Yes, please',
      'tenant-123',
      'conv-456',
      '+1234567890',
    );

    expect(mockConversationsService.fetchRecentMessages).toHaveBeenCalledWith('tenant-123', 'conv-456', 20);
    expect(mockGraph.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ content: '(Client): Do you offer teeth cleaning?' }),
          expect.objectContaining({ content: '(Staff): Yes, we do teeth cleaning for 5000 DZD.' }),
        ],
      }),
      expect.objectContaining({
        configurable: {
          tenantId: 'tenant-123',
          conversationId: 'conv-456',
          phoneNumber: '+1234567890',
        },
      }),
    );

    expect(result).toEqual({
      reply: 'Would you like to book an appointment?',
      escalated: false,
    });
  });

  it('detects escalation when escalate_to_human tool was called', async () => {
    mockConversationsService.fetchRecentMessages.mockResolvedValue([]);

    mockGraph.invoke.mockResolvedValue({
      messages: [
        new HumanMessage('(Client): Do you perform zygomatic implants?'),
        new ToolMessage({
          name: 'escalate_to_human',
          content: JSON.stringify({
            status: 'escalated',
            reason: 'Zygomatic implants not found in knowledge base',
            message: 'Let me check with our clinic staff and get back to you shortly.',
          }),
          tool_call_id: 'call-1',
        }),
      ],
    });

    const result = await agentService.getResponse(
      'Do you perform zygomatic implants?',
      'tenant-123',
      'conv-456',
    );

    expect(result.escalated).toBe(true);
    expect(result.escalationReason).toBe('Zygomatic implants not found in knowledge base');
    expect(result.reply).toBe('Let me check with our clinic staff and get back to you shortly.');
  });

  describe('booking tool safeguard during takeover', () => {
    it('skips booking creation if conversation status is not ai_active', async () => {
      const mockBookingService = { createBooking: jest.fn() };
      const mockTx = {
        conversations: {
          findUnique: jest.fn().mockResolvedValue({ status: 'human_active' }),
        },
      };
      const mockTenantTx = {
        run: jest.fn(async (_tenantId: string, fn: (tx: any) => Promise<any>) => fn(mockTx)),
      };

      const bookingTool = createBookingTool(
        mockBookingService as any,
        mockTenantTx as any,
      );

      const toolResult = await bookingTool.invoke(
        { service: 'Consultation', date: '2026-09-10', time: '10:00' },
        { configurable: { tenantId: 'tenant-1', phoneNumber: '+1234567890', conversationId: 'conv-1' } },
      );

      expect(toolResult).toContain('human takeover mode');
      expect(mockBookingService.createBooking).not.toHaveBeenCalled();
    });
  });
});
