import { AgentState } from '../agent-state';
import { ChatGoogle } from '@langchain/google';

export function createAgentNode(model: ChatGoogle) {
  return async function agentNode(state: typeof AgentState.State) {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };
}
