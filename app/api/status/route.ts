import { prisma } from "@/lib/db";
import { isGranolaInstalled } from "@/lib/granola";

export async function GET() {
  try {
    const [googleToken, slackToken, lastSync, taskCount, callCount] = await Promise.all([
      prisma.oAuthToken.findUnique({ where: { provider: "google" } }),
      prisma.oAuthToken.findUnique({ where: { provider: "slack" } }),
      prisma.syncLog.findFirst({ orderBy: { syncedAt: "desc" } }),
      prisma.task.count({ where: { status: "open" } }),
      prisma.granolaCall.count(),
    ]);

    return Response.json({
      google: !!googleToken,
      slack: !!slackToken,
      granola: isGranolaInstalled(),
      lastSync: lastSync?.syncedAt || null,
      taskCount,
      callCount,
    });
  } catch (e) {
    console.error("[/api/status]", e);
    return Response.json(
      { google: false, slack: false, granola: false, lastSync: null, taskCount: 0, callCount: 0, error: String(e) },
      { status: 500 }
    );
  }
}
