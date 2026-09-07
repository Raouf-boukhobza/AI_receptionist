import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly prismaService: PrismaService) {}

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
}
