-- This is an empty migration.


CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_base
(
    id         UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    content    TEXT        NOT NULL,
    embedding  VECTOR(1536)  NOT NULL,
    metadata   JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON knowledge_base
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);
CREATE INDEX idx_knowledge_base_tenants ON knowledge_base (tenant_id);