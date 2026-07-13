import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const now = new Date();

    if (req.nextUrl.searchParams.get("statsOnly") === "true") {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const [doneThisWeek, overdue] = await Promise.all([
        prisma.task.count({ where: { status: "done", updatedAt: { gte: startOfWeek } } }),
        prisma.task.count({ where: { status: "open", deadline: { lt: now } } }),
      ]);
      return Response.json({ doneThisWeek, overdue });
    }

    const view = req.nextUrl.searchParams.get("view") || "today";
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const snoozeFilter = {
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    };

    const where =
      view === "today"
        ? {
            status: "open" as const,
            OR: [
              { priority: { in: ["critical", "high"] } },
              { deadline: { lte: endOfToday } },
            ],
            AND: [snoozeFilter],
          }
        : view === "week"
        ? {
            status: "open" as const,
            OR: [
              { deadline: { lte: endOfWeek } },
              { priority: { in: ["critical", "high", "medium"] } },
            ],
            AND: [snoozeFilter],
          }
        : { status: "open" as const, AND: [snoozeFilter] };

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ priority: "asc" }, { deadline: "asc" }, { createdAt: "desc" }],
      take: 50,
    });

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    tasks.sort(
      (a, b) =>
        (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4) -
        (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4)
    );

    return Response.json(tasks);
  } catch (e) {
    console.error("[/api/tasks GET]", e);
    return Response.json([], { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, snoozedUntil: snoozeInput, ...rest } = body;

    let snoozedUntil: Date | null | undefined = undefined;
    if (snoozeInput === "tomorrow") {
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
      snoozedUntil = d;
    } else if (snoozeInput === "next-week") {
      const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0);
      snoozedUntil = d;
    } else if (snoozeInput === null) {
      snoozedUntil = null;
    }

    const data: Record<string, unknown> = {};
    if (rest.status !== undefined) data.status = rest.status;
    if (rest.title !== undefined) data.title = rest.title;
    if (rest.description !== undefined) data.description = rest.description;
    if (rest.priority !== undefined) data.priority = rest.priority;
    if (rest.impact !== undefined) data.impact = rest.impact;
    if (rest.projectLabel !== undefined) data.projectLabel = rest.projectLabel;
    if (rest.deadline !== undefined) data.deadline = rest.deadline ? new Date(rest.deadline) : null;
    if (snoozedUntil !== undefined) data.snoozedUntil = snoozedUntil;

    const task = await prisma.task.update({ where: { id }, data });
    return Response.json(task);
  } catch (e) {
    console.error("[/api/tasks PATCH]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description || null,
        priority: body.priority || "medium",
        impact: body.impact || null,
        deadline: body.deadline ? new Date(body.deadline) : null,
        source: body.source || "manual",
        rawContext: body.rawContext || null,
      },
    });
    return Response.json(task);
  } catch (e) {
    console.error("[/api/tasks POST]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return Response.json({ error: "Not found" }, { status: 404 });

    await prisma.task.delete({ where: { id } });

    // Learn exclusion rule from this deletion
    let learnedRule = null;
    try {
      const { learnExclusionRule } = await import("@/lib/claude");
      const rule = await learnExclusionRule(task.title, task.rawContext);
      const ruleId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      await prisma.$executeRaw`INSERT INTO ExclusionRule (id, pattern, intent, keywords, sourceTaskId) VALUES (${ruleId}, ${rule.pattern}, ${rule.intent}, ${JSON.stringify(rule.keywords)}, ${id})`;
      learnedRule = rule.pattern;
    } catch { /* non-critical */ }

    return Response.json({ ok: true, learnedRule });
  } catch (e) {
    console.error("[/api/tasks DELETE]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
