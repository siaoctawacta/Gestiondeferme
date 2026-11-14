/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `AuditLog` table (the journal is immutable).
  - A unique constraint covering the columns `[buildingId,name]` on the table `Zone` will be added.
    If there are existing duplicate zone names inside a building, this migration will fail.

*/
-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "updatedAt";

-- CreateIndex
CREATE INDEX "Building_siteId_idx" ON "Building"("siteId");

-- CreateIndex
CREATE INDEX "Zone_farmId_idx" ON "Zone"("farmId");

-- CreateIndex
CREATE INDEX "Zone_buildingId_idx" ON "Zone"("buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_buildingId_name_key" ON "Zone"("buildingId", "name");

-- CreateIndex
CREATE INDEX "UserFarm_farmId_idx" ON "UserFarm"("farmId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "LoginLog_userId_idx" ON "LoginLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_farmId_idx" ON "AuditLog"("farmId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
