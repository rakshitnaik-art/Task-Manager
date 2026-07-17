import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [googleToken, slackToken, lastSync, taskCount] = await Promise.all([
      prisma.oAuthToken.findUnique({ where: { provider: "google" } }),
      prisma.oAuthToken.findUnique({ where: { provider: "slack" } }),
      prisma.syncLog.findFirst({ orderBy: { syncedAt: "desc" } }),
      prisma.task.count({ where: { status: "open" } }),
    ]);

    return Response.json({
      google: !!googleToken,
      slack: !!slackToken,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      db: process.env.TURSO_DATABASE_URL ? "turso" : "local",
      lastSync: lastSync?.syncedAt || null,
      taskCount,
    });
  } catch (e) {
    console.error("[/api/status]", e);
    return Response.json(
      { google: false, slack: false, lastSync: null, taskCount: 0, error: String(e) },
      { status: 500 }
    );
  }
}
