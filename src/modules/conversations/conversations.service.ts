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
}
