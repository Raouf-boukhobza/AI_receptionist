CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE tenant_status AS ENUM ('active', 'incomplete', 'expired');

CREATE TABLE tenants (
                         id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                         business_name VARCHAR(255) NOT NULL,
                         email VARCHAR(255) NOT NULL UNIQUE,
                         password_hash VARCHAR(255) NOT NULL,
                         waba_id VARCHAR(255) UNIQUE,
                         phone_number_id VARCHAR(255) UNIQUE,
                         access_token VARCHAR(255),
                         status tenant_status NOT NULL DEFAULT 'incomplete',
                         whatsapp_connected_at TIMESTAMP,
                         knowledge_base_passed_at TIMESTAMP,
                         created_at TIMESTAMP NOT NULL DEFAULT now(),
                         updated_at TIMESTAMP NOT NULL DEFAULT now()
);