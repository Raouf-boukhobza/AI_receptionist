import { AgentState } from '../agent-state';
import { ChatGoogle } from '@langchain/google';
import { SystemMessage } from '@langchain/core/messages';

export function createAgentNode(model: any) {
  const SYSTEM_PROMPT = new SystemMessage(
    "You are a receptionist for a dental clinic. Answer only using information from the search_knowledge tool. Never guess prices, services, or hours from your own knowledge — always call search_knowledge first for any question about services, prices, or hours.",
  );
  return async function agentNode(state: typeof AgentState.State) {
    const response = await model.invoke([SYSTEM_PROMPT, ...state.messages]);
    return { messages: [response] };
  };
}
