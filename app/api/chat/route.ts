import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { fetchUpcomingEvents } from "@/lib/google";
import { getSettings } from "@/lib/settings";

function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY || getSettings().anthropicKey;
  return new Anthropic({ apiKey: key });
}

// Auto-create table on first use — no manual migration needed
async function ensureProjectContextTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "ProjectContext" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectLabel" TEXT NOT NULL,
      "url" TEXT,
      "title" TEXT,
      "note" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
}

const tools: Anthropic.Tool[] = [
  {
    name: "create_task",
    description: "Create a new task the user wants to track.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Verb-first task title, e.g. 'Review Hertz contract'" },
        description: { type: "string", description: "What needs doing and why" },
        priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
        deadline: { type: "string", description: "ISO date string, e.g. 2026-07-20" },
      },
      required: ["title", "priority"],
    },
  },
  {
    name: "save_project_context",
    description: "Save URLs, docs, or notes as context for a project. Use when the user shares links or reference material they want associated with a project name.",
    input_schema: {
      type: "object" as const,
      properties: {
        projectLabel: { type: "string", description: "The project name, e.g. 'Beacon', 'Comcast Onboarding'" },
        items: {
          type: "array",
          description: "List of URLs or notes to save",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "The URL" },
              title: { type: "string", description: "Short label for what this link is, e.g. 'Analytics Dashboard', 'PRD Doc'" },
              note: { type: "string", description: "Optional note about this resource" },
            },
          },
        },
      },
      required: ["projectLabel", "items"],
    },
  },
  {
    name: "add_exclusion_rule",
    description: "Tell future syncs to never surface tasks matching a pattern. Use when the user says they don't want certain types of tasks to appear.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "One sentence describing what to exclude" },
        intent: { type: "string", description: "Why this is noise for the PM" },
        keywords: { type: "array", items: { type: "string" }, description: "Keywords that identify this pattern" },
      },
      required: ["pattern", "intent", "keywords"],
    },
  },
  {
    name: "mark_task_done",
    description: "Mark one or more tasks as done by their IDs.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskIds: { type: "array", items: { type: "string" } },
      },
      required: ["taskIds"],
    },
  },
  {
    name: "snooze_task",
    description: "Snooze a task until a future date.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        until: { type: "string", description: "ISO date string" },
      },
      required: ["taskId", "until"],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "create_task") {
    const task = await prisma.task.create({
      data: {
        title: input.title as string,
        description: (input.description as string) || null,
        priority: (input.priority as string) || "medium",
        deadline: input.deadline ? new Date(input.deadline as string) : null,
        source: "chat",
        status: "open",
      },
    });
    return JSON.stringify({ ok: true, id: task.id, title: task.title });
  }

  if (name === "save_project_context") {
    await ensureProjectContextTable();
    const items = input.items as Array<{ url?: string; title?: string; note?: string }>;
    const label = input.projectLabel as string;
    for (const item of items) {
      const id = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "ProjectContext" ("id", "projectLabel", "url", "title", "note", "createdAt")
        VALUES (${id}, ${label}, ${item.url ?? null}, ${item.title ?? null}, ${item.note ?? null}, datetime('now'))
      `;
    }
    return JSON.stringify({ ok: true, saved: items.length, projectLabel: label });
  }

  if (name === "add_exclusion_rule") {
    const rule = await prisma.exclusionRule.create({
      data: {
        pattern: input.pattern as string,
        intent: input.intent as string,
        keywords: JSON.stringify(input.keywords),
      },
    });
    return JSON.stringify({ ok: true, id: rule.id });
  }

  if (name === "mark_task_done") {
    const ids = input.taskIds as string[];
    await prisma.task.updateMany({ where: { id: { in: ids } }, data: { status: "done" } });
    return JSON.stringify({ ok: true, updated: ids.length });
  }

  if (name === "snooze_task") {
    await prisma.task.update({
      where: { id: input.taskId as string },
      data: { snoozedUntil: new Date(input.until as string) },
    });
    return JSON.stringify({ ok: true });
  }

  return JSON.stringify({ error: "Unknown tool" });
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json() as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  await ensureProjectContextTable();

  const [tasks, exclusions, contextRows, events] = await Promise.all([
    prisma.task.findMany({
      where: { status: "open" },
      orderBy: [{ priority: "asc" }, { deadline: "asc" }],
      select: { id: true, title: true, priority: true, deadline: true, projectLabel: true, description: true, createdAt: true },
    }),
    prisma.exclusionRule.findMany({ select: { pattern: true }, take: 20 }),
    prisma.$queryRaw`SELECT projectLabel, url, title, note FROM "ProjectContext" ORDER BY createdAt DESC` as Promise<Array<{ projectLabel: string; url: string | null; title: string | null; note: string | null }>>,
    fetchUpcomingEvents(2).catch(() => [] as Array<{ title: string; start: string; end: string; isOrganizer?: boolean }>),
  ]);

  const now2 = new Date();
  const todayEvents = events.filter(e => {
    const start = new Date(e.start);
    const endOfToday = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate(), 23, 59, 59);
    return start <= endOfToday && start >= now2;
  });

  // Group project contexts by label
  const contextByProject: Record<string, Array<{ url?: string; title?: string; note?: string }>> = {};
  for (const row of contextRows) {
    if (!contextByProject[row.projectLabel]) contextByProject[row.projectLabel] = [];
    contextByProject[row.projectLabel].push({ url: row.url ?? undefined, title: row.title ?? undefined, note: row.note ?? undefined });
  }

  const today = new Date();
  const priorityOrder = ["critical", "high", "medium", "low"];
  const sorted = [...tasks].sort((a, b) => {
    const pa = priorityOrder.indexOf(a.priority);
    const pb = priorityOrder.indexOf(b.priority);
    return pa !== pb ? pa - pb : (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity);
  });

  const taskList = sorted.map(t => {
    const overdue = t.deadline && t.deadline < today ? ` [OVERDUE since ${t.deadline.toISOString().slice(0, 10)}]` : "";
    const deadline = t.deadline ? ` | due ${t.deadline.toISOString().slice(0, 10)}` : "";
    const project = t.projectLabel ? ` | ${t.projectLabel}` : "";
    return `- [${t.id}] [${t.priority.toUpperCase()}]${overdue} ${t.title}${deadline}${project}`;
  }).join("\n");

  const projectContextSection = Object.entries(contextByProject).length > 0
    ? "\nPROJECT REFERENCE DOCS:\n" + Object.entries(contextByProject).map(([label, items]) =>
        `${label}:\n` + items.map(i => `  - ${i.title || "Link"}: ${i.url || ""}${i.note ? ` (${i.note})` : ""}`).join("\n")
      ).join("\n")
    : "";

  const todayISTStr = today.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata" });
  const timeISTStr = today.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", hour12: true });

  const settings = getSettings();
  const userDescriptor = settings.userName
    ? `${settings.userName}, a Product Manager`
    : `a Product Manager`;

  const system = `You are a smart productivity assistant for ${userDescriptor}.

TODAY: ${todayISTStr} · ${timeISTStr} IST

OPEN TASKS (${tasks.length} total):
${taskList || "No open tasks."}
${projectContextSection}

TODAY'S MEETINGS (upcoming):
${todayEvents.length > 0 ? todayEvents.map(e => {
  const start = new Date(e.start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata", hour12: true });
  return `- ${start} IST — ${e.title}`;
}).join("\n") : "No meetings today"}

ACTIVE EXCLUSION RULES:
${exclusions.map(e => `- ${e.pattern}`).join("\n") || "None"}

You can:
- Answer questions about tasks (what's overdue, what to focus on, project breakdowns)
- Create new tasks the user mentions
- Save URLs/docs as reference context for a project — when user shares links for a project, use save_project_context
- Add exclusion rules when user says to stop surfacing certain types of tasks
- Mark tasks done or snooze them
- When discussing a project, include relevant reference docs from PROJECT REFERENCE DOCS in your answer

RULES:
- When asked what to work on first: overdue > critical > high > earliest deadline
- When asked to "plan my day", "action plan", or "what should I work on": generate a time-blocked plan in this format:
  🚨 BLOCK 1 — Do Now (tasks that are overdue or critical)
  🟡 BLOCK 2 — Before [next meeting time] IST (high priority tasks)
  📅 BLOCK 3 — Rest of Day (medium priority, can be done between meetings)
  For each block: list 2-3 tasks with a one-line reason and rough time estimate (~15 min, ~1 hr, etc.)
  Factor in meeting times — don't schedule heavy work right before meetings.
- When user says "never show me X" or "exclude X from future syncs" → add_exclusion_rule
- When user shares URLs for a project ("here are the Beacon docs") → save_project_context
- When answering about a project that has saved docs → mention them with their URLs
- Be concise. Bullet points for lists. No filler phrases.`;

  const apiMessages: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const anthropic = getAnthropic();
  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system,
    tools,
    messages: apiMessages,
  });

  // Tool-use loop
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: await runTool(block.name, block.input as Record<string, unknown>),
      }))
    );

    apiMessages.push({ role: "assistant", content: response.content });
    apiMessages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      tools,
      messages: apiMessages,
    });
  }

  const textBlock = response.content.find(b => b.type === "text");
  return Response.json({
    reply: textBlock?.type === "text" ? textBlock.text : "Sorry, I couldn't generate a response.",
  });
}
