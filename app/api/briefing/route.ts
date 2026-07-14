import { prisma } from "@/lib/db";
import { fetchUpcomingEvents } from "@/lib/google";
import { generateMorningBriefing } from "@/lib/claude";

export async function GET() {
  const now = new Date();
  const ACTIVE = ["open", "in_progress", "blocked"];

  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: { status: { in: ACTIVE } },
      select: { id: true, title: true, priority: true, deadline: true, projectLabel: true, status: true },
      orderBy: [{ priority: "asc" }, { deadline: "asc" }],
      take: 50,
    }),
    fetchUpcomingEvents(1).catch(() => []),
  ]);

  // Filter events to today only
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const todayEvents = events.filter(e => e.start && new Date(e.start) <= endOfToday);

  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
  });

  const briefing = await generateMorningBriefing({ tasks, events: todayEvents, date: dateStr });

  return Response.json({ briefing, generatedAt: now.toISOString() });
}
