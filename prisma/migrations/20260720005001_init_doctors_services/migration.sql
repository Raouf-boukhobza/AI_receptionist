-- This is an empty migration.


-- init_doctor_services migration

CREATE TABLE doctor_services (
                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                                 doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
                                 service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                                 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

                                 UNIQUE (doctor_id, service_id)
);

ALTER TABLE doctor_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON doctor_services
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_doctor_services_tenants ON doctor_services (tenant_id);
CREATE INDEX idx_doctor_services_doctor ON doctor_services (doctor_id);
CREATE INDEX idx_doctor_services_service ON doctor_services (service_id);