import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';
import { AgentController } from './agent.controller';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { EmbeddingModule } from '../../../common/embedding/embedding.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { BookingModule } from '../booking/booking.module';

@Module({
  imports: [
    KnowledgeBaseModule,
    EmbeddingModule,
    ConversationsModule,
    BookingModule,
  ],
  controllers: [AgentController],
  providers: [AgentService, AgentGraphBuilder],
  exports: [AgentService],
})
export class AgentModule {}
