import { Injectable } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';
import { ConversationsService } from '../conversations/conversations.service';
import { toLangChainMessage } from './mappers/db-message.mapper';

@Injectable()
export class AgentService {
  private readonly graph;
  constructor(
    private readonly agentGraphBuilder: AgentGraphBuilder,
    private readonly conversationService: ConversationsService,
  ) {
    this.graph = this.agentGraphBuilder.buildGraph();
  }

  async getResponse(input: string, tenantId: string , conversationId: string) {
    const history  = await this.conversationService.fetchMessages(conversationId);
    const messages = history.map(toLangChainMessage);
    messages.push(new HumanMessage(input));
    return this.graph.invoke(
      {
        messages: messages,
      },
      {
        configurable: { tenantId: tenantId  , conversationId: conversationId},
      },
    );
  }
}
