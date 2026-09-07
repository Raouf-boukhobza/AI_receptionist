import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const escalateToHumanSchema = z.object({
  reason: z
    .string()
    .describe(
      'The reason for escalating to a human staff member (e.g., missing knowledge, medical decision, or explicit customer request)',
    ),
  holdingMessage: z
    .string()
    .optional()
    .describe(
      'An optional polite holding message to send to the client while staff is notified. If not provided, a standard friendly holding message will be used.',
    ),
});

export const DEFAULT_HOLDING_MESSAGE =
  'Let me check with our clinic staff and get back to you shortly.';

export function createEscalateToHumanTool() {
  return tool(
    async ({ reason , holdingMessage }) => {
      return JSON.stringify({
        status: 'escalated',
        reason,
        message: holdingMessage?.trim() || DEFAULT_HOLDING_MESSAGE,
      });
    },
    {
      name: 'escalate_to_human',
      description:
        'Call this tool when the client asks a question that is NOT found in the knowledge base, requires staff/doctor confirmation, or when the client explicitly asks to speak to a human.',
      schema: escalateToHumanSchema,
    },
  );
}
