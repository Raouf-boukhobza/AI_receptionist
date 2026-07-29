-- This is an empty migration.


ALTER TABLE "tenants"
ADD COLUMN refresh_token VARCHAR(255);