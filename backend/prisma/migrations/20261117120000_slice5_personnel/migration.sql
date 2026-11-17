-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CDI', 'CDD', 'JOURNALIER', 'STAGE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'CONGE', 'MALADIE');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT,
    "jobTitle" TEXT NOT NULL,
    "phone" TEXT,
    "contractType" "ContractType" NOT NULL,
    "hireDate" DATE NOT NULL,
    "endDate" DATE,
    "monthlySalary" DECIMAL(12,2),
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "hours" DECIMAL(4,2),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employee_farmId_idx" ON "Employee"("farmId");

-- CreateIndex
CREATE INDEX "Employee_userId_idx" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_farmId_name_key" ON "Employee"("farmId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_farmId_userId_key" ON "Employee"("farmId", "userId");

-- CreateIndex
CREATE INDEX "Attendance_farmId_date_idx" ON "Attendance"("farmId", "date");

-- CreateIndex
CREATE INDEX "Attendance_createdById_idx" ON "Attendance"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_monthlySalary_check" CHECK ("monthlySalary" IS NULL OR "monthlySalary" >= 0);
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_endDate_check" CHECK ("endDate" IS NULL OR "endDate" >= "hireDate");
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_hours_check" CHECK ("hours" IS NULL OR ("hours" > 0 AND "hours" <= 24));
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_hours_present_check" CHECK ("hours" IS NULL OR "status" = 'PRESENT');
