import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const URL_REGEX = /https?:\/\/[^\s)>"'\]]+/g;

function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_REGEX) || [])];
}

function domainLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Known domains → friendly labels
    if (host.includes("docs.google.com")) return "Google Doc";
    if (host.includes("sheets.google.com") || url.includes("spreadsheets")) return "Google Sheet";
    if (host.includes("drive.google.com")) return "Google Drive";
    if (host.includes("slack.com")) return "Slack";
    if (host.includes("notion.so")) return "Notion";
    if (host.includes("capillarytech.com")) return "Capillary";
    if (host.includes("jira") || host.includes("atlassian")) return "Jira";
    if (host.includes("github.com")) return "GitHub";
    if (host.includes("figma.com")) return "Figma";
    return host;
  } catch {
    return url.slice(0, 40);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return Response.json({ error: "Not found" }, { status: 404 });

  // Extract all URLs from description + rawContext
  const combinedText = `${task.description || ""} ${task.rawContext || ""}`;
  const rawUrls = extractUrls(combinedText);
  const extractedLinks = rawUrls.map(url => ({ url, label: domainLabel(url) }));

  // Project context docs (saved via chat)
  let projectDocs: Array<{ url: string | null; title: string | null; note: string | null }> = [];
  if (task.projectLabel) {
    try {
      projectDocs = await prisma.$queryRaw`
        SELECT url, title, note FROM "ProjectContext"
        WHERE projectLabel = ${task.projectLabel}
        ORDER BY createdAt DESC
      ` as typeof projectDocs;
    } catch {
      // Table may not exist yet
    }
  }

  // Related Granola meeting notes
  const callMappings = await prisma.callMapping.findMany({
    where: { taskId: id },
    include: { call: true },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    task,
    extractedLinks,
    projectDocs,
    relatedCalls: callMappings.map(m => ({
      id: m.call.id,
      title: m.call.title,
      startedAt: m.call.startedAt,
      summary: m.call.summary,
      transcript: m.call.transcript?.slice(0, 1200),
      attendees: m.call.attendees ? JSON.parse(m.call.attendees) : [],
      notes: m.notes,
      confidence: m.confidence,
    })),
  });
}
