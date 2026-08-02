-- CreateEnum
CREATE TYPE "day_of_week" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "doctor_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "day" "day_of_week" NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_doctor_hours_doctor" ON "doctor_hours"("doctor_id");

-- CreateIndex
CREATE INDEX "idx_doctor_hours_tenants" ON "doctor_hours"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_hours_doctor_id_day_key" ON "doctor_hours"("doctor_id", "day");

-- AddForeignKey
ALTER TABLE "doctor_hours" ADD CONSTRAINT "doctor_hours_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doctor_hours" ADD CONSTRAINT "doctor_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
