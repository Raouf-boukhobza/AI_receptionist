import { Injectable } from '@nestjs/common';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';

@Injectable()
export class AgentService {
  private readonly graph;
  constructor(private readonly agentGraphBuilder: AgentGraphBuilder) {
    this.graph = this.agentGraphBuilder.buildGraph();
  }

  async getResponse(
    message: string,
    tenantId: string,
    conversationId: string,
    phoneNumber?: string,
  ): Promise<string> {
    const result = await this.graph.invoke(
      {
        messages: [new HumanMessage(message)],
      },
      {
        configurable: {
          thread_id: conversationId,
          tenantId: tenantId,
          conversationId: conversationId,
          phoneNumber: phoneNumber,
        },
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
