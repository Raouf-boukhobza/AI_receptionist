import { Injectable } from '@nestjs/common';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
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

  async getResponse(
    messages: BaseMessage[],
    tenantId: string,
    conversationId: string,
  ): Promise<string> {
    const result = await this.graph.invoke(
      {
        messages: messages,
      },
      {
        configurable: { tenantId: tenantId, conversationId: conversationId },
      },
    );

    return this.extractAiReply(result.messages);
  }

  extractAiReply(messages: BaseMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg instanceof AIMessage &&
        typeof msg.content === 'string' &&
        msg.content.trim()
      ) {
        return msg.content.trim();
      }
    }
    throw new Error('No AI reply found in messages');
  }
}
