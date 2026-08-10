import { Injectable } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import { AgentState } from '../agent-state';
import { createAgentNode } from './agent.node';
import { ChatGoogle } from '@langchain/google';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AgentGraphBuilder {
  private readonly model: ChatGoogle;
  constructor(private readonly configService: ConfigService) {
    this.model = new ChatGoogle({
      model: 'gemini-3.6-flash',
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
  }

  buildGraph() {
    const graph = new StateGraph(AgentState);
    graph
      .addNode('agent', createAgentNode(this.model))
      .addEdge(START, 'agent')
      .addEdge('agent', END);
    return graph.compile();
  }
}
