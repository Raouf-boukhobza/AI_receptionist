-- init_services migration

CREATE TABLE services (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                          name TEXT NOT NULL,
                          price NUMERIC(10,2) NOT NULL,
                          duration_minutes INT NOT NULL,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON services
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_services_tenants ON services (tenant_id);