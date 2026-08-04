import { Module } from '@nestjs/common';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { EmbeddingModule } from '../../../common/embedding/embedding.module';
import { TenantModule } from '../tenantModule/tenant.module';

@Module({
  imports: [EmbeddingModule, TenantModule],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
