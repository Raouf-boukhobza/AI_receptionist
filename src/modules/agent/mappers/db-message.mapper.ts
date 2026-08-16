import {messages} from "../../../../generated/prisma/client";
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';


export function toLangChainMessage(message: messages) : BaseMessage {
    switch (message.sender) {
        case 'client':
            return new HumanMessage({
                content: message.content,
                additional_kwargs: {
                    sender: 'client',
                },
            });

        case 'ai':
            return new AIMessage({
                content: message.content,
            });

        case 'owner':
            return new HumanMessage({
                content: message.content,
                additional_kwargs: {
                    sender: 'owner',
                },
            });

        default:
            throw new Error(`Unsupported message sender: ${message.sender}`);
    }
}