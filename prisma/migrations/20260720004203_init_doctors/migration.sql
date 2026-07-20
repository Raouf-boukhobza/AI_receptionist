-- This is an empty migration.
-- init_doctors migration

CREATE TABLE doctors (
                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                         tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                         name TEXT NOT NULL,
                         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON doctors
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_doctors_tenants ON doctors (tenant_id);