import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

function cuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function GET() {
  const rules = await prisma.$queryRaw`SELECT * FROM ExclusionRule ORDER BY createdAt DESC` as Array<{ id: string; pattern: string; intent: string; keywords: string; sourceTaskId: string | null; createdAt: string }>;
  return Response.json(rules);
}

export async function POST(req: NextRequest) {
  const { pattern, intent, keywords, sourceTaskId } = await req.json();
  const id = cuid();
  const keywordsStr = Array.isArray(keywords) ? JSON.stringify(keywords) : (keywords || "[]");
  await prisma.$executeRaw`INSERT INTO ExclusionRule (id, pattern, intent, keywords, sourceTaskId) VALUES (${id}, ${pattern}, ${intent || ""}, ${keywordsStr}, ${sourceTaskId || null})`;
  return Response.json({ id, pattern, intent, keywords: keywordsStr });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await prisma.$executeRaw`DELETE FROM ExclusionRule WHERE id = ${id}`;
  return Response.json({ ok: true });
}
