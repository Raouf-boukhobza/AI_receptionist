import { forwardRef, Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';
import { AgentController } from './agent.controller';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { EmbeddingModule } from '../../../common/embedding/embedding.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { BookingModule } from '../booking/booking.module';
import { MessagingModule } from '../messaging/messaging.module';
import { async } from 'rxjs';
import { Pool } from 'pg';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

@Module({
  imports: [
    KnowledgeBaseModule,
    EmbeddingModule,
    ConversationsModule,
    BookingModule,
  ],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentGraphBuilder,
    {
      inject : [ConfigService],
      provide: 'CHECKPOINTER',
      useFactory: async (configService: ConfigService) => {
        const setupPool = new Pool({
          connectionString: configService.get<string>('MIGRATE_DATABASE_URL'),
        });
        const setupCheckpointer = new PostgresSaver(setupPool);
        await setupCheckpointer.setup();
        await setupPool.end();
        // 2. Runtime phase — app_user, used by the graph
        const runtimePool = new Pool({
          connectionString: process.env.DATABASE_URL,
        });
        const checkpointer = new PostgresSaver(runtimePool);
        return checkpointer;
      },
    },
  ],
  exports: [AgentService, 'CHECKPOINTER'],
})
export class AgentModule {}
