/*
  Warnings:

  - Added the required column `business_phone` to the `tenants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `tenants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `personal_phone` to the `tenants` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "business_phone" VARCHAR(255) NOT NULL,
ADD COLUMN     "name" VARCHAR(255) NOT NULL,
ADD COLUMN     "personal_phone" VARCHAR(255) NOT NULL;
