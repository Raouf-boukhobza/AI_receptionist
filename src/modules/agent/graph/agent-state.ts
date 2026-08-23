import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { messagesStateReducer } from '@langchain/langgraph';

/**
 * Structured booking info collected during conversation.
 * Contains exactly what the LLM needs to invoke the create_booking tool.
 */
export interface BookingInfo {
  /** Service name the client wants to book */
  service: string;
  /** Requested date in YYYY-MM-DD format */
  date: string;
  /** Requested time in HH:mm format */
  time: string;
  /** Preferred doctor name, if the client specified one */
  doctorName?: string;
}

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /**
   * Booking info progressively collected from the conversation.
   * Null until the client starts expressing booking intent.
   * Latest write wins — each update replaces the previous value.
   */
  booking: Annotation<BookingInfo | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});
