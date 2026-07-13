-- AlterTable: add projectLabel and snoozedUntil to Task
ALTER TABLE "Task" ADD COLUMN "projectLabel" TEXT;
ALTER TABLE "Task" ADD COLUMN "snoozedUntil" DATETIME;

-- CreateTable: ExclusionRule
CREATE TABLE IF NOT EXISTS "ExclusionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
