import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TenantTransaction } from '../../../common/tenant-context/tenant-transaction';
import { OutboundMessagesQueue } from '../messaging/queue/outbound-messages.queue';
import { GetConversationsQueryDto } from './dtos/get-conversations-query.dto';
import { OwnerReplyDto } from './dtos/owner-reply.dto';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tenantTransaction: TenantTransaction,
    private readonly outboundMessagesQueue: OutboundMessagesQueue,
  ) {}

  async fetchMessages(conversationId: string) {
    return this.prismaService.db.messages.findMany({
      where: {
        conversation_id: conversationId,
      },
      orderBy: {
        created_at: 'asc',
      },
    });
  }

  /**
   * Fetches the latest N messages for a conversation, ordered chronologically (oldest -> newest).
   * Excludes failed/dead messages so the AI only sees valid conversation history.
   */
  async fetchRecentMessages(
    tenantId: string,
    conversationId: string,
    limit: number = 20,
  ) {
    const rawMessages = await this.prismaService.db.messages.findMany({
      where: {
        tenant_id: tenantId,
        conversation_id: conversationId,
        status: {
          notIn: ['dispatch_failed', 'dead', 'undeliverable'],
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
    });

    return rawMessages.reverse();
  }

  /**
   * Lists conversations for the authenticated tenant with pagination and optional status filter.
   */
  async getConversations(tenantId: string, query: GetConversationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    return this.tenantTransaction.run(tenantId, async (tx) => {
      const where = {
        tenant_id: tenantId,
        ...(query.status ? { status: query.status } : {}),
      };

      const [items, total] = await Promise.all([
        tx.conversations.findMany({
          where,
          orderBy: {
            updated_at: 'desc',
          },
          skip,
          take: limit,
          include: {
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        }),
        tx.conversations.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Fetches a conversation with its full message history.
   * Throws NotFoundException if conversation does not exist or belongs to another tenant.
   */
  async getConversationById(tenantId: string, conversationId: string) {
    return this.tenantTransaction.run(tenantId, async (tx) => {
      const conversation = await tx.conversations.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: { created_at: 'asc' },
          },
        },
      });

      if (!conversation || conversation.tenant_id !== tenantId) {
        throw new NotFoundException('Conversation not found');
      }

      return conversation;
    });
  }

  /**
   * Staff replies to a conversation from the dashboard.
   * Persists message with sender: 'owner', updates conversation status/version,
   * and enqueues to outboundQueue for WhatsApp delivery.
   */
  async replyToConversation(
    tenantId: string,
    conversationId: string,
    dto: OwnerReplyDto,
  ) {
    const result = await this.tenantTransaction.run(tenantId, async (tx) => {
      const conversation = await tx.conversations.findUnique({
        where: { id: conversationId },
      });

      if (!conversation || conversation.tenant_id !== tenantId) {
        throw new NotFoundException('Conversation not found');
      }

      const createdMessage = await tx.messages.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversationId,
          sender: 'owner',
          content: dto.content,
          status: 'pending_dispatch',
        },
      });

      const newStatus = dto.resumeAi !== false ? 'ai_active' : 'human_active';

      await tx.conversations.update({
        where: { id: conversationId },
        data: {
          status: newStatus,
          version: { increment: 1 },
          updated_at: new Date(),
        },
      });

      return { createdMessage, newStatus };
    });

    // Enqueue outbound dispatch after database transaction commits
    await this.outboundMessagesQueue.addJob({
      tenantId,
      messageId: result.createdMessage.id,
    });

    return result.createdMessage;
  }

  /**
   * Manually changes conversation status between 'ai_active' and 'human_active'.
   */
  async updateStatus(
    tenantId: string,
    conversationId: string,
    newStatus: 'ai_active' | 'human_active',
  ) {
    return this.tenantTransaction.run(tenantId, async (tx) => {
      const conversation = await tx.conversations.findUnique({
        where: { id: conversationId },
      });

      if (!conversation || conversation.tenant_id !== tenantId) {
        throw new NotFoundException('Conversation not found');
      }

      return tx.conversations.update({
        where: { id: conversationId },
        data: {
          status: newStatus,
          version: { increment: 1 },
          updated_at: new Date(),
        },
      });
    });
  }
}
