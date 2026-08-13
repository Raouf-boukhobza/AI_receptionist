import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';
import { AgentController } from './agent.controller';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { EmbeddingModule } from '../../../common/embedding/embedding.module';


@Module({
  imports: [
    KnowledgeBaseModule,
    EmbeddingModule
  ],
  controllers: [AgentController],
  providers: [AgentService , AgentGraphBuilder],
  exports : [AgentService]
})
export class AgentModule {}