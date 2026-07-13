import { prisma } from "@/lib/db";
import { fetchRecentEmailThreads, fetchUpcomingEvents, fetchRecentDocs, fetchPinnedSheets } from "@/lib/google";
import { fetchRecentSlackMessages } from "@/lib/slack";
import { fetchGranolaMeetings } from "@/lib/granola";
import { analyzeAndExtractTasks, collateTaskContext, checkExclusionRules, deduplicateTasks, collapseRelatedTasks, mapCallToTasks, groupTasksByProject, ExtractedTask } from "@/lib/claude";

export async function POST() {
  const errors: string[] = [];
  const log = async (source: string, status: "ok" | "error", message?: string) => {
    await prisma.syncLog.create({ data: { source, status, message: message || null } });
  };

  // Incremental email fetch — only pull threads since last successful sync,
  // but always look back at least 2 hours so a rapid re-sync never misses recent emails
  const lastEmailSync = await prisma.syncLog.findFirst({
    where: { source: "gmail", status: "ok" },
    orderBy: { syncedAt: "desc" },
  });
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const emailSince = lastEmailSync && lastEmailSync.syncedAt > twoHoursAgo
    ? twoHoursAgo
    : lastEmailSync?.syncedAt;

  // Fetch all data sources in parallel
  const [emails, events, docs, pinnedSheets, slackMessages, granolaCalls] = await Promise.allSettled([
    fetchRecentEmailThreads(emailSince, 60),
    fetchUpcomingEvents(),
    fetchRecentDocs(),
    fetchPinnedSheets(),
    fetchRecentSlackMessages(),
    fetchGranolaMeetings(),
  ]);

  const emailData = emails.status === "fulfilled" ? emails.value : (errors.push("gmail"), []);
  const eventData = events.status === "fulfilled" ? events.value : (errors.push("calendar"), []);
  const docData = docs.status === "fulfilled" ? docs.value : (errors.push("drive"), []);
  const pinnedSheetData = pinnedSheets.status === "fulfilled" ? pinnedSheets.value : (errors.push("pinned-sheets"), []);
  const slackData = slackMessages.status === "fulfilled" ? slackMessages.value : (errors.push("slack"), []);
  const granolaData = granolaCalls.status === "fulfilled" ? granolaCalls.value : (errors.push("granola"), []);

  await Promise.all([
    log("gmail", emails.status === "fulfilled" ? "ok" : "error", `${emailData.length} threads`),
    log("calendar", events.status === "fulfilled" ? "ok" : "error"),
    log("drive", docs.status === "fulfilled" ? "ok" : "error"),
    log("sheets", pinnedSheets.status === "fulfilled" ? "ok" : "error", `${pinnedSheetData.length} sheets`),
    log("slack", slackMessages.status === "fulfilled" ? "ok" : "error"),
    log("granola", granolaCalls.status === "fulfilled" ? "ok" : "error"),
  ]);

  // Analyse emails in chunks of 40 to stay within Claude's context window
  const extractedTasks: ExtractedTask[] = [];
  const EMAIL_CHUNK = 40;

  try {
    // Fetch recently completed tasks for recurring task detection
    const recentDone = await prisma.task.findMany({
      where: { status: "done", updatedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
      select: { title: true },
    });
    const recentDoneTasks = recentDone.map(t => t.title);

    // Pre-filter emails whose thread IDs already have a task — avoid re-evaluating known threads
    const existingSourceRefs = await prisma.task.findMany({
      where: { sourceRef: { not: null } },
      select: { sourceRef: true },
    });
    const seenRefs = new Set(existingSourceRefs.map(t => t.sourceRef!));
    const unseenEmails = emailData.filter(e => !seenRefs.has(e.id));
    await log("sync-preflight", "ok", `${emailData.length} threads fetched, ${unseenEmails.length} unseen (${emailData.length - unseenEmails.length} skipped — already processed)`);

    // First pass: non-email sources + first email chunk
    const firstChunk = unseenEmails.slice(0, EMAIL_CHUNK);
    const firstBatch = await analyzeAndExtractTasks({
      emails: firstChunk,
      events: eventData,
      docs: [...docData, ...pinnedSheetData],
      slackMessages: slackData,
      recentDoneTasks,
    });
    extractedTasks.push(...firstBatch);

    // Remaining email chunks (emails only, no need to re-send calendar/slack/docs)
    for (let i = EMAIL_CHUNK; i < unseenEmails.length; i += EMAIL_CHUNK) {
      const chunk = unseenEmails.slice(i, i + EMAIL_CHUNK);
      const batch = await analyzeAndExtractTasks({
        emails: chunk,
        events: [],
        docs: [],
        slackMessages: [],
        recentDoneTasks,
      });
      extractedTasks.push(...batch);
    }

    // Drop low-confidence extractions before any further processing
    const beforeConfFilter = extractedTasks.length;
    const lowConf = extractedTasks.filter(t => (t.confidence ?? 1) < 0.65);
    extractedTasks.splice(0, extractedTasks.length, ...extractedTasks.filter(t => (t.confidence ?? 1) >= 0.65));
    await log("claude-analysis", "ok", `${extractedTasks.length} tasks from ${unseenEmails.length} unseen threads (${lowConf.length} dropped — low confidence, was ${beforeConfFilter})`);

    // Collapse related tasks within this batch (same ticket, active/passive variations, same project+action)
    const collapsed = await collapseRelatedTasks([...extractedTasks]);
    extractedTasks.length = 0;
    extractedTasks.push(...collapsed);
    await log("claude-collapse", "ok", `${collapsed.length} tasks after collapsing related`);

    // Collate context from Slack messages and Granola meetings into each task
    const meetings = granolaData;
    const collated = await collateTaskContext([...extractedTasks], slackData, meetings);
    extractedTasks.length = 0;
    extractedTasks.push(...collated);

    // Fetch existing open task titles for deduplication
    const existingTasks = await prisma.task.findMany({ where: { status: "open" }, select: { title: true } });
    const existingTitles = existingTasks.map(t => t.title);
    const deduped = await deduplicateTasks([...extractedTasks], existingTitles);

    // Filter against learned exclusion rules
    const rules = await prisma.$queryRaw`SELECT pattern, keywords FROM ExclusionRule` as Array<{ pattern: string; keywords: string }>;
    const filtered = await checkExclusionRules(deduped, rules);

    extractedTasks.length = 0;
    extractedTasks.push(...filtered);

    await log("claude-collation", "ok", `context collated across ${slackData.length} slack msgs and ${meetings.length} meetings`);
  } catch (e) {
    await log("claude-analysis", "error", String(e));
  }

  // Upsert tasks — skip duplicates by sourceRef
  const savedTasks = [];
  for (const task of extractedTasks) {
    try {
      const existing = task.sourceRef
        ? await prisma.task.findFirst({ where: { sourceRef: task.sourceRef } })
        : null;

      if (existing) {
        savedTasks.push(existing);
        continue;
      }

      const saved = await prisma.task.create({
        data: {
          title: task.title,
          description: task.description || null,
          priority: task.priority,
          impact: task.impact || null,
          deadline: task.deadline ? new Date(task.deadline) : null,
          source: task.source,
          sourceRef: task.sourceRef || null,
          rawContext: task.rawContext ? JSON.stringify(task.rawContext) : null,
        },
      });
      savedTasks.push(saved);
    } catch {
      // skip individual task errors
    }
  }

  // Sync Granola calls and map to tasks
  for (const call of granolaData) {
    try {
      const existing = await prisma.granolaCall.findUnique({ where: { granolaId: call.id } });
      if (existing?.synced) continue;

      const granolaCall = await prisma.granolaCall.upsert({
        where: { granolaId: call.id },
        create: {
          granolaId: call.id,
          title: call.title,
          startedAt: new Date(call.startedAt),
          duration: call.duration || null,
          transcript: call.transcript || null,
          summary: call.summary || null,
          attendees: call.attendees ? JSON.stringify(call.attendees) : null,
        },
        update: {
          title: call.title,
          summary: call.summary || null,
        },
      });

      if (savedTasks.length > 0) {
        const mapping = await mapCallToTasks(
          { title: call.title, summary: call.summary, transcript: call.transcript, attendees: call.attendees },
          savedTasks.map((t) => ({ id: t.id, title: t.title, description: t.description }))
        );

        await prisma.callMapping.create({
          data: {
            callId: granolaCall.id,
            taskId: mapping.taskId || null,
            notes: mapping.notes,
            confidence: mapping.confidence,
            confirmed: !mapping.needsConfirmation && mapping.confidence > 0.7,
          },
        });

        if (!mapping.needsConfirmation) {
          await prisma.granolaCall.update({ where: { id: granolaCall.id }, data: { synced: true } });
        }
      }
    } catch {
      // skip individual call errors
    }
  }

  // Auto-group newly saved tasks into projects
  try {
    const ungrouped = await prisma.task.findMany({
      where: { status: "open", projectLabel: null },
      select: { id: true, title: true, description: true },
    });
    if (ungrouped.length > 0) {
      const groupings = await groupTasksByProject(ungrouped);
      for (const { id, projectLabel } of groupings) {
        if (projectLabel) await prisma.task.update({ where: { id }, data: { projectLabel } });
      }
    }
  } catch {
    // non-fatal
  }

  return Response.json({
    ok: true,
    threadsFetched: emailData.length,
    tasksExtracted: extractedTasks.length,
    callsSynced: granolaData.length,
    errors,
  });
}
