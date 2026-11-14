/*
  Warnings:

  - Added the required column `organizationId` to the `AuditLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
