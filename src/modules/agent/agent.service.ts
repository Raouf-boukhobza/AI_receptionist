import { Injectable } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { AgentGraphBuilder } from './graph/nodes/agent-graph.builder';

@Injectable()
export class AgentService {
  private readonly graph;

  constructor(private readonly agentGraphBuilder: AgentGraphBuilder) {
    this.graph = this.agentGraphBuilder.buildGraph();
  }

  async getResponse(input: string , tenantId: string) {
    return this.graph.invoke(
      {
        messages: [new HumanMessage(input)],
      },
      {
        configurable: { tenantId: tenantId },
      },
    );
  }
}
