-- This is an empty migration.
-- init_notifications migration

CREATE TYPE notification_type AS ENUM (
  'ai_escalation',
  'booking_created',
  'subscription_expiring',
  'payment_failed'
);

CREATE TABLE notifications (
                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                               tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                               type notification_type NOT NULL,
                               link TEXT,
                               read_at TIMESTAMPTZ,
                               created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON notifications
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_notifications_tenants ON notifications (tenant_id);