import { Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { JwtAuthGuard } from '../tenantModule/guards/jwt.guard';
import { TenantContextInterceptor } from '../../../common/tenant-context/tenant-context.interceptor';
import { TenantId } from '../../../common/tenant-context/tenant-id.decorator';

@Controller({
  path: 'knowledge-base',
  version: '1',
})
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Post()
  async createKnowledgeBase(@TenantId() tenantId: string) {
    return this.knowledgeBaseService.syncTenantKnowledgeBase(tenantId);
  }
}
