import { ConversationsController } from '../../src/modules/conversations/conversations.controller';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { GetConversationsQueryDto } from '../../src/modules/conversations/dtos/get-conversations-query.dto';
import { OwnerReplyDto } from '../../src/modules/conversations/dtos/owner-reply.dto';
import { UpdateConversationStatusDto } from '../../src/modules/conversations/dtos/update-conversation-status.dto';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let mockConversationsService: {
    getConversations: jest.Mock;
    getConversationById: jest.Mock;
    replyToConversation: jest.Mock;
    updateStatus: jest.Mock;
  };

  beforeEach(() => {
    mockConversationsService = {
      getConversations: jest.fn(),
      getConversationById: jest.fn(),
      replyToConversation: jest.fn(),
      updateStatus: jest.fn(),
    };

    controller = new ConversationsController(
      mockConversationsService as unknown as ConversationsService,
    );
  });

  describe('getConversations', () => {
    it('delegates to service.getConversations with tenantId and query', async () => {
      const query: GetConversationsQueryDto = { page: 1, limit: 10, status: 'needs_human' };
      const expected = { items: [], total: 0, page: 1, limit: 10, totalPages: 0 };
      mockConversationsService.getConversations.mockResolvedValue(expected);

      const result = await controller.getConversations('tenant-1', query);

      expect(mockConversationsService.getConversations).toHaveBeenCalledWith('tenant-1', query);
      expect(result).toEqual(expected);
    });
  });

  describe('getConversationById', () => {
    it('delegates to service.getConversationById with tenantId and conversationId', async () => {
      const mockConv = { id: 'conv-123', tenant_id: 'tenant-1' };
      mockConversationsService.getConversationById.mockResolvedValue(mockConv);

      const result = await controller.getConversationById('tenant-1', 'conv-123');

      expect(mockConversationsService.getConversationById).toHaveBeenCalledWith('tenant-1', 'conv-123');
      expect(result).toEqual(mockConv);
    });
  });

  describe('replyToConversation', () => {
    it('delegates to service.replyToConversation with tenantId, id, and dto', async () => {
      const dto: OwnerReplyDto = { content: 'Hello patient', resumeAi: false };
      const mockMsg = { id: 'msg-1', content: 'Hello patient' };
      mockConversationsService.replyToConversation.mockResolvedValue(mockMsg);

      const result = await controller.replyToConversation('tenant-1', 'conv-123', dto);

      expect(mockConversationsService.replyToConversation).toHaveBeenCalledWith(
        'tenant-1',
        'conv-123',
        dto,
      );
      expect(result).toEqual(mockMsg);
    });
  });

  describe('updateStatus', () => {
    it('delegates to service.updateStatus with tenantId, id, and dto.status', async () => {
      const dto: UpdateConversationStatusDto = { status: 'human_active' };
      const mockConv = { id: 'conv-123', status: 'human_active' };
      mockConversationsService.updateStatus.mockResolvedValue(mockConv);

      const result = await controller.updateStatus('tenant-1', 'conv-123', dto);

      expect(mockConversationsService.updateStatus).toHaveBeenCalledWith(
        'tenant-1',
        'conv-123',
        'human_active',
      );
      expect(result).toEqual(mockConv);
    });
  });
});
