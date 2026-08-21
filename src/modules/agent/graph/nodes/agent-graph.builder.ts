import { Injectable } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import { AgentState } from '../agent-state';
import { createAgentNode } from './agent.node';
import { ChatGoogle } from '@langchain/google';
import { ConfigService } from '@nestjs/config';
import { createSearchKnowledgeTool } from '../tools/search-knowledge.tool';
import { EmbeddingService } from '../../../../../common/embedding/embedding.service';
import { KnowledgeBaseService } from '../../../knowledge-base/knowledge-base.service';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { TenantTransaction } from '../../../../../common/tenant-context/tenant-transaction';

@Injectable()
export class AgentGraphBuilder {
  private readonly model: ChatGoogle;
  constructor(
    private readonly configService: ConfigService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly embeddingService: EmbeddingService,
    private readonly tenantTransaction: TenantTransaction,
  ) {
    this.model = new ChatGoogle({
      model: 'gemini-3.6-flash',
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
  }

  buildGraph() {
    const searchKnowledgeTool = createSearchKnowledgeTool(
      this.knowledgeBaseService,
      this.embeddingService,
      this.tenantTransaction,
    );
    const tools = [searchKnowledgeTool];
    const modelWithTools = this.model.bindTools(tools);

    const graph = new StateGraph(AgentState);
    graph
      .addNode('agent', createAgentNode(modelWithTools))
      .addNode('tools', new ToolNode(tools))
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', toolsCondition)
      .addEdge('tools', 'agent');

    return graph.compile();
  }
}

