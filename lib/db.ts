import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl && process.env.NODE_ENV === "production") {
    throw new Error("TURSO_DATABASE_URL is not set. Add it to Railway Variables.");
  }

  const url = tursoUrl ?? `file:${path.join(process.cwd(), "dev.db")}`;
  console.log(`[db] connecting to: ${tursoUrl ? "Turso (" + tursoUrl.slice(0, 40) + "...)" : "local dev.db"}`);

  const adapter = new PrismaLibSql({ url, authToken });
  return new PrismaClient({ adapter } as never);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
