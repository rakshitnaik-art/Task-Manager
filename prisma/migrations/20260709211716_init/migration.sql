-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "scope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL,
    "impact" TEXT,
    "deadline" DATETIME,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rawContext" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GranolaCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "granolaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "duration" INTEGER,
    "transcript" TEXT,
    "summary" TEXT,
    "attendees" TEXT,
    "synced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CallMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "taskId" TEXT,
    "notes" TEXT,
    "confidence" REAL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallMapping_callId_fkey" FOREIGN KEY ("callId") REFERENCES "GranolaCall" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CallMapping_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_provider_key" ON "OAuthToken"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "GranolaCall_granolaId_key" ON "GranolaCall"("granolaId");
