-- init_bookings migration

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE booking_status AS ENUM ('confirmed', 'cancelled', 'completed');

CREATE TABLE bookings (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                          doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
                          service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
                          client_phone TEXT NOT NULL,
                          start_time TIMESTAMPTZ NOT NULL,
                          end_time TIMESTAMPTZ NOT NULL,
                          status booking_status NOT NULL DEFAULT 'confirmed',
                          reminder_24h_job_id TEXT,
                          reminder_1h_job_id TEXT,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

                          EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_time, end_time) WITH &&
) WHERE (status <> 'cancelled')
);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_policy
ON bookings
USING (
    tenant_id = current_setting('app.current_tenant')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.current_tenant')::uuid
);

CREATE INDEX idx_bookings_tenants ON bookings (tenant_id);
CREATE INDEX idx_bookings_doctor ON bookings (doctor_id);
CREATE INDEX idx_bookings_start_time ON bookings (start_time);