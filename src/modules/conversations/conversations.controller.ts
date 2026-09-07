import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';
import { GetConversationsQueryDto } from './dtos/get-conversations-query.dto';
import { OwnerReplyDto } from './dtos/owner-reply.dto';
import { UpdateConversationStatusDto } from './dtos/update-conversation-status.dto';

@Controller({
  path: 'conversations',
  version: '1',
})
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  async getConversations(
    @TenantId() tenantId: string,
    @Query() query: GetConversationsQueryDto,
  ) {
    return this.conversationsService.getConversations(tenantId, query);
  }

  @Get(':id')
  async getConversationById(
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.getConversationById(tenantId, conversationId);
  }

  @Post(':id/reply')
  async replyToConversation(
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
    @Body() dto: OwnerReplyDto,
  ) {
    return this.conversationsService.replyToConversation(
      tenantId,
      conversationId,
      dto,
    );
  }

  @Patch(':id/status')
  async updateStatus(
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
    @Body() dto: UpdateConversationStatusDto,
  ) {
    return this.conversationsService.updateStatus(
      tenantId,
      conversationId,
      dto.status,
    );
  }
}
