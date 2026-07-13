import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const calls = await prisma.granolaCall.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      include: {
        callMappings: {
          include: { task: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    return Response.json(calls);
  } catch (e) {
    console.error("[/api/calls GET]", e);
    return Response.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { callId, taskId, confirmed } = await req.json();
    const mapping = await prisma.callMapping.findFirst({ where: { callId } });

    if (mapping) {
      const updated = await prisma.callMapping.update({
        where: { id: mapping.id },
        data: { taskId: taskId || null, confirmed: confirmed ?? true },
      });
      await prisma.granolaCall.update({ where: { id: callId }, data: { synced: true } });
      return Response.json(updated);
    }

    const created = await prisma.callMapping.create({
      data: { callId, taskId: taskId || null, confirmed: true, confidence: 1.0, notes: "Manually assigned" },
    });
    await prisma.granolaCall.update({ where: { id: callId }, data: { synced: true } });
    return Response.json(created);
  } catch (e) {
    console.error("[/api/calls POST]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
