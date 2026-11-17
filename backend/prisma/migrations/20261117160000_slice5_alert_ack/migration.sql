-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('A_VOIR', 'URGENT');

-- CreateTable
CREATE TABLE "AlertAck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertAck_userId_idx" ON "AlertAck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertAck_userId_key_key" ON "AlertAck"("userId", "key");

-- AddForeignKey
ALTER TABLE "AlertAck" ADD CONSTRAINT "AlertAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
