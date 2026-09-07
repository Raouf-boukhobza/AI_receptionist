import { Injectable } from '@nestjs/common';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';
import { ConversationsService } from '../conversations/conversations.service';
import { toLangChainMessage } from './mappers/db-message.mapper';
import { DEFAULT_HOLDING_MESSAGE } from './graph/tools/escalate-to-human.tool';

export interface AgentExecutionResult {
  reply: string;
  escalated: boolean;
  escalationReason?: string;
}

@Injectable()
export class AgentService {
  private readonly graph;
  constructor(
    private readonly agentGraphBuilder: AgentGraphBuilder,
    private readonly conversationsService: ConversationsService,
  ) {
    this.graph = this.agentGraphBuilder.buildGraph();
  }

  async getResponse(
    message: string,
    tenantId: string,
    conversationId: string,
    phoneNumber?: string,
  ): Promise<AgentExecutionResult> {
    // 1. Fetch recent conversation messages from PostgreSQL (single source of truth)
    const recentMessages = await this.conversationsService.fetchRecentMessages(
      tenantId,
      conversationId,
      20,
    );

    // 2. Map database messages to LangChain messages with clear role labels
    let inputMessages: BaseMessage[] = recentMessages.map(toLangChainMessage);

    // If history is empty, initialize with current message
    if (inputMessages.length === 0) {
      inputMessages = [new HumanMessage({ content: `(Client): ${message}` })];
    }

    // 3. Invoke stateless graph
    const result = await this.graph.invoke(
      {
        messages: inputMessages,
      },
      {
        configurable: {
          tenantId,
          conversationId,
          phoneNumber,
        },
      },
    );

    // 4. Check if escalate_to_human tool was called
    const escalation = this.checkEscalation(result.messages);
    if (escalation) {
      return escalation;
    }

    // 5. Extract normal AI reply
    const reply = this.extractAiReply(result.messages);
    return {
      reply,
      escalated: false,
    };
  }

  checkEscalation(messages: BaseMessage[]): AgentExecutionResult | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg instanceof ToolMessage && msg.name === 'escalate_to_human') {
        try {
          const parsed =
            typeof msg.content === 'string'
              ? JSON.parse(msg.content)
              : msg.content;
          return {
            reply: parsed.message || DEFAULT_HOLDING_MESSAGE,
            escalated: true,
            escalationReason: parsed.reason,
          };
        } catch {
          return {
            reply: DEFAULT_HOLDING_MESSAGE,
            escalated: true,
            escalationReason: 'Escalation requested by agent',
          };
        }
      }
    }
    return null;
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
