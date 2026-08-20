
CREATE TYPE message_status AS ENUM (
  'received', 'processing', 'replied', 'escalated',
  'pending_dispatch', 'sending', 'sent', 'dispatch_failed',
  'delivered', 'read', 'undeliverable', 'dead'
);

ALTER TABLE messages ADD COLUMN status message_status DEFAULT 'received',
                     ADD COLUMN wa_message_id       varchar(128),               -- Meta "wamid.*"
                     ADD COLUMN reply_to_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
                     ADD COLUMN dispatch_attempts   int  NOT NULL DEFAULT 0,
                     ADD COLUMN last_error          text,
                     ADD COLUMN dispatched_at       timestamptz,
                     ADD COLUMN delivered_at        timestamptz
;
CREATE UNIQUE INDEX uq_messages_tenant_wamid
    ON messages (tenant_id, wa_message_id)
    WHERE wa_message_id IS NOT NULL;

-- Layer 3: AT MOST ONE AI reply per inbound message  ← the "don't repeat the LLM" guard
CREATE UNIQUE INDEX uq_messages_reply_to
    ON messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;

-- ── Outbox sweeper index (partial → tiny, stays hot in cache) ────────────────
CREATE INDEX idx_messages_outbox
    ON messages (created_at)
    WHERE status IN ('pending_dispatch', 'dispatch_failed');



