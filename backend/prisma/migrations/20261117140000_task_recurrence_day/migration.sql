-- AlterTable
ALTER TABLE "Task" ADD COLUMN "recurrenceDay" INTEGER;

-- Invariants
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceDay_check" CHECK ("recurrenceDay" IS NULL OR ("recurrenceDay" >= 1 AND "recurrenceDay" <= 31));
