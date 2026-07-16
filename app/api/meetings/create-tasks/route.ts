import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { meetingTitle, actionItems } = await req.json() as {
    meetingTitle: string;
    actionItems: string[];
  };

  if (!actionItems?.length) {
    return Response.json({ error: "no action items" }, { status: 400 });
  }

  const created = await Promise.all(
    actionItems.map((item: string) =>
      prisma.task.create({
        data: {
          title: item,
          description: `From meeting: ${meetingTitle}`,
          priority: "medium",
          source: "meeting",
          status: "open",
          projectLabel: meetingTitle || null,
        },
      })
    )
  );

  return Response.json({ ok: true, created: created.length, ids: created.map(t => t.id) });
}
