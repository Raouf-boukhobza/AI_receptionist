-- Add 'system' sender for automated messages (e.g. appointment reminders)
-- that must send regardless of staff-takeover suppression rules.
ALTER TYPE "message_sender" ADD VALUE 'system';

-- Template routing for outbound reminders (Meta 24h-window exemption).
-- NULL = plain-text send (existing behavior, untouched).
ALTER TABLE "messages" ADD COLUMN "template_name" TEXT;
ALTER TABLE "messages" ADD COLUMN "template_params" JSONB;
