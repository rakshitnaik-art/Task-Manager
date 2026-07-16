import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import fs from "fs";
import os from "os";
import path from "path";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function ensureTaskoraDir(): string {
  const dir = path.join(os.homedir(), ".taskora");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createPrismaClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  let url: string;
  let source: string;

  if (tursoUrl) {
    url = tursoUrl;
    source = `Turso (${tursoUrl.slice(0, 40)}...)`;
  } else {
    const taskoraDir = ensureTaskoraDir();
    const dbPath = path.join(taskoraDir, "taskora.db");
    url = `file:${dbPath}`;
    source = `local ~/.taskora/taskora.db`;
  }

  console.log(`[db] connecting to: ${source}`);

  const adapter = new PrismaLibSql({ url, authToken });
  return new PrismaClient({ adapter } as never);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
