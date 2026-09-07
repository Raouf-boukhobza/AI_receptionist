-- Add version column to conversations for optimistic concurrency control
ALTER TABLE "conversations" ADD COLUMN "version" INT NOT NULL DEFAULT 1;
