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
        'LAST RESORT ONLY. Call ONLY AFTER you have already called search_knowledge (for info questions) or create_booking/update_booking/cancel_booking (for booking requests) and the tool result proves you cannot help. NEVER call this as your first action. NEVER call this to avoid calling another tool. For info questions you MUST call search_knowledge first and only escalate if it returns found:false. For booking requests you MUST call the booking tool first and present its output — NEVER escalate on SERVICE_NOT_FOUND, DOCTOR_NOT_AVAILABLE, or UNAVAILABLE, just relay the result to the client. Only escalate immediately (without prior tool call) if the client explicitly asks for a human/doctor/staff or reports an emergency/complex complaint.',
      schema: escalateToHumanSchema,
    },
  );
}
