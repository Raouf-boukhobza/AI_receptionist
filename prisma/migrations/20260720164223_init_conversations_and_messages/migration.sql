-- This is an empty migration.

CREATE TYPE message_sender AS ENUM ('client', 'ai', 'owner');
CREATE TYPE conversation_status AS ENUM ('ai_active', 'needs_human', 'human_active');

CREATE TABLE conversations (
                               id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                               tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                               client_phone TEXT NOT NULL,
                               status conversation_status NOT NULL DEFAULT 'ai_active',
                               created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                               updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON conversations
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_conversations_tenants ON conversations (tenant_id);
CREATE INDEX idx_conversations_phone ON conversations (client_phone);

CREATE TABLE messages (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                          conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                          sender message_sender NOT NULL,
                          content TEXT NOT NULL,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON messages
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_messages_tenants ON messages (tenant_id);
CREATE INDEX idx_messages_conversation ON messages (conversation_id);