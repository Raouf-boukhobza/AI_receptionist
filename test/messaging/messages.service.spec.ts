import { MessagesService } from '../../src/modules/messaging/messages.service';
import { TenantService } from '../../src/modules/tenantModule/tenant.service';
import { TenantTransaction } from '../../common/tenant-context/tenant-transaction';
import { InboundMessagesQueue } from '../../src/modules/messaging/queue/inbound-messages.queue';
import { WhatsappWebhookDto } from '../../src/modules/messaging/dtos/whatsAppWebhook.dto';

describe('MessagesService', () => {
  let service: MessagesService;
  let mockTenantService: { getTenantIdByPhoneNumberId: jest.Mock };
  let mockTenantTransaction: { run: jest.Mock };
  let mockInboundMessagesQueue: { addJob: jest.Mock };
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      messages: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      conversations: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockTenantService = {
      getTenantIdByPhoneNumberId: jest.fn(),
    };

    mockTenantTransaction = {
      run: jest.fn().mockImplementation((tenantId: string, fn: (tx: any) => Promise<any>) => fn(mockTx)),
    };

    mockInboundMessagesQueue = {
      addJob: jest.fn().mockResolvedValue(undefined),
    };

    service = new MessagesService(
      mockTenantService as unknown as TenantService,
      mockTenantTransaction as unknown as TenantTransaction,
      mockInboundMessagesQueue as unknown as InboundMessagesQueue,
    );
  });

  describe('WhatsApp Mobile Echoes (Coexistence / Staff phone replies)', () => {
    const buildEchoPayload = (echoOverrides: any = {}): WhatsappWebhookDto => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'smb_message_echoes',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: 'pn-123',
                  display_phone_number: '+15550001',
                },
                message_echoes: [
                  {
                    id: 'wamid.echo1',
                    to: '+1234567890',
                    timestamp: '1725700000',
                    type: 'text',
                    text: { body: 'Hello, this is Dr. Sarah replying.' },
                    ...echoOverrides,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    it('creates new conversation with status human_active if none exists and saves owner message', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue(null); // Not duplicate
      mockTx.conversations.findFirst.mockResolvedValue(null); // No existing conv
      mockTx.conversations.create.mockResolvedValue({ id: 'conv-new', status: 'human_active' });
      mockTx.messages.create.mockResolvedValue({ id: 'msg-echo-1' });

      const result = await service.saveInboundMessage(buildEchoPayload());

      expect(mockTenantService.getTenantIdByPhoneNumberId).toHaveBeenCalledWith('pn-123');
      expect(mockTx.conversations.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          client_phone: '+1234567890',
          status: 'human_active',
          version: 1,
        },
      });
      expect(mockTx.messages.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          conversation_id: 'conv-new',
          sender: 'owner',
          content: 'Hello, this is Dr. Sarah replying.',
          status: 'sent',
          wa_message_id: 'wamid.echo1',
        },
      });
      // Crucial: No AI job queued for staff echoes!
      expect(mockInboundMessagesQueue.addJob).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('updates existing conversation to human_active, increments version, and saves echo message', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue(null);
      mockTx.conversations.findFirst.mockResolvedValue({ id: 'conv-existing', status: 'ai_active', version: 2 });
      mockTx.conversations.update.mockResolvedValue({ id: 'conv-existing', status: 'human_active', version: 3 });
      mockTx.messages.create.mockResolvedValue({ id: 'msg-echo-2' });

      await service.saveInboundMessage(buildEchoPayload());

      expect(mockTx.conversations.update).toHaveBeenCalledWith({
        where: { id: 'conv-existing' },
        data: {
          status: 'human_active',
          version: { increment: 1 },
          updated_at: expect.any(Date),
        },
      });
      expect(mockTx.messages.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversation_id: 'conv-existing',
          sender: 'owner',
          status: 'sent',
        }),
      });
      expect(mockInboundMessagesQueue.addJob).not.toHaveBeenCalled();
    });

    it('skips duplicate echo message (idempotency)', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue({
        id: 'msg-already-saved',
        conversation_id: 'conv-existing',
      });

      const result = await service.saveInboundMessage(buildEchoPayload());

      expect(mockTx.conversations.create).not.toHaveBeenCalled();
      expect(mockTx.conversations.update).not.toHaveBeenCalled();
      expect(mockTx.messages.create).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          messageId: 'msg-already-saved',
          conversationId: 'conv-existing',
          tenantId: 'tenant-1',
          waMessageId: 'wamid.echo1',
        },
      ]);
    });
  });

  describe('Inbound Client Messages', () => {
    const buildClientPayload = (msgOverrides: any = {}): WhatsappWebhookDto => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: 'pn-123',
                  display_phone_number: '+15550001',
                },
                messages: [
                  {
                    id: 'wamid.client1',
                    from: '+1234567890',
                    timestamp: '1725700000',
                    type: 'text',
                    text: { body: 'What time are you open tomorrow?' },
                    ...msgOverrides,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    it('saves client message and queues AI job when conversation is ai_active', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue(null);
      mockTx.conversations.findFirst.mockResolvedValue({
        id: 'conv-1',
        status: 'ai_active',
      });
      mockTx.conversations.update.mockResolvedValue({});
      mockTx.messages.create.mockResolvedValue({ id: 'msg-client-1' });

      await service.saveInboundMessage(buildClientPayload());

      expect(mockTx.messages.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          conversation_id: 'conv-1',
          sender: 'client',
          content: 'What time are you open tomorrow?',
          status: 'received',
          wa_message_id: 'wamid.client1',
        },
      });
      // Should enqueue AI processing
      expect(mockInboundMessagesQueue.addJob).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        messageId: 'msg-client-1',
      });
    });

    it('saves client message but DOES NOT queue AI job when conversation is human_active', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue(null);
      mockTx.conversations.findFirst.mockResolvedValue({
        id: 'conv-1',
        status: 'human_active',
      });
      mockTx.conversations.update.mockResolvedValue({});
      mockTx.messages.create.mockResolvedValue({ id: 'msg-client-2' });

      await service.saveInboundMessage(buildClientPayload());

      expect(mockTx.messages.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversation_id: 'conv-1',
          sender: 'client',
          status: 'received',
        }),
      });
      // AI MUST NOT be queued when staff is in control!
      expect(mockInboundMessagesQueue.addJob).not.toHaveBeenCalled();
    });

    it('saves client message but DOES NOT queue AI job when conversation is needs_human', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue(null);
      mockTx.conversations.findFirst.mockResolvedValue({
        id: 'conv-1',
        status: 'needs_human',
      });
      mockTx.conversations.update.mockResolvedValue({});
      mockTx.messages.create.mockResolvedValue({ id: 'msg-client-3' });

      await service.saveInboundMessage(buildClientPayload());

      expect(mockTx.messages.create).toHaveBeenCalled();
      // AI MUST NOT be queued when conversation is waiting for human!
      expect(mockInboundMessagesQueue.addJob).not.toHaveBeenCalled();
    });

    it('creates new conversation with status ai_active by default for brand new client', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue(null);
      mockTx.conversations.findFirst.mockResolvedValue(null);
      mockTx.conversations.create.mockResolvedValue({
        id: 'conv-brand-new',
        status: 'ai_active',
      });
      mockTx.messages.create.mockResolvedValue({ id: 'msg-client-4' });

      await service.saveInboundMessage(buildClientPayload());

      expect(mockTx.conversations.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          client_phone: '+1234567890',
          status: 'ai_active',
        },
      });
      expect(mockInboundMessagesQueue.addJob).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        messageId: 'msg-client-4',
      });
    });

    it('skips duplicate inbound message (idempotency)', async () => {
      mockTenantService.getTenantIdByPhoneNumberId.mockResolvedValue('tenant-1');
      mockTx.messages.findFirst.mockResolvedValue({
        id: 'msg-already-saved',
        conversation_id: 'conv-1',
      });

      const result = await service.saveInboundMessage(buildClientPayload());

      expect(mockTx.conversations.create).not.toHaveBeenCalled();
      expect(mockTx.messages.create).not.toHaveBeenCalled();
      expect(mockInboundMessagesQueue.addJob).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          messageId: 'msg-already-saved',
          conversationId: 'conv-1',
          tenantId: 'tenant-1',
          waMessageId: 'wamid.client1',
        },
      ]);
    });
  });
});
