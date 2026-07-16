import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { meetingId, text, startTime, sequence } = await req.json();
  if (!meetingId || !text?.trim()) {
    return Response.json({ error: "meetingId and text required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await prisma.$executeRaw`
    INSERT INTO "LocalTranscript" ("id", "meetingId", "text", "startTime", "sequence", "createdAt")
    VALUES (${id}, ${meetingId}, ${text.trim()}, ${startTime ?? null}, ${sequence ?? null}, ${now})
  `;

  return Response.json({ ok: true, id });
}
