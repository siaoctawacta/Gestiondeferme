-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('A_FAIRE', 'EN_COURS', 'TERMINEE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('NORMALE', 'HAUTE', 'URGENTE');

-- CreateEnum
CREATE TYPE "TaskRecurrence" AS ENUM ('AUCUNE', 'QUOTIDIENNE', 'HEBDOMADAIRE', 'MENSUELLE');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "dueDate" DATE NOT NULL,
    "dueTime" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMALE',
    "status" "TaskStatus" NOT NULL DEFAULT 'A_FAIRE',
    "recurrence" "TaskRecurrence" NOT NULL DEFAULT 'AUCUNE',
    "batchId" TEXT,
    "buildingId" TEXT,
    "equipmentId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedDate" DATE,
    "completedById" TEXT,
    "proofPath" TEXT,
    "proofMime" TEXT,
    "previousTaskId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_previousTaskId_key" ON "Task"("previousTaskId");

-- CreateIndex
CREATE INDEX "Task_farmId_idx" ON "Task"("farmId");

-- CreateIndex
CREATE INDEX "Task_farmId_status_idx" ON "Task"("farmId", "status");

-- CreateIndex
CREATE INDEX "Task_farmId_dueDate_idx" ON "Task"("farmId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "Task_batchId_idx" ON "Task"("batchId");

-- CreateIndex
CREATE INDEX "Task_buildingId_idx" ON "Task"("buildingId");

-- CreateIndex
CREATE INDEX "Task_equipmentId_idx" ON "Task"("equipmentId");

-- CreateIndex
CREATE INDEX "Task_completedById_idx" ON "Task"("completedById");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AnimalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_previousTaskId_fkey" FOREIGN KEY ("previousTaskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Invariants
ALTER TABLE "Task" ADD CONSTRAINT "Task_dueTime_check" CHECK ("dueTime" IS NULL OR "dueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "Task" ADD CONSTRAINT "Task_one_target_check" CHECK (num_nonnulls("batchId", "buildingId", "equipmentId") <= 1);
ALTER TABLE "Task" ADD CONSTRAINT "Task_completed_check" CHECK (("status" = 'TERMINEE') = ("completedDate" IS NOT NULL));
ALTER TABLE "Task" ADD CONSTRAINT "Task_proof_check" CHECK (("proofPath" IS NULL) = ("proofMime" IS NULL));
