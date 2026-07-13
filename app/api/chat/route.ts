import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    name: "add_exclusion_rule",
    description: "Tell future syncs to never surface tasks matching a pattern. Use when the user says they don't want to see certain types of tasks in future.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "One sentence describing what to exclude, e.g. 'FTP monitoring alerts from automated systems'" },
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
        taskIds: { type: "array", items: { type: "string" }, description: "Array of task IDs to mark done" },
      },
      required: ["taskIds"],
    },
  },
  {
    name: "snooze_task",
    description: "Snooze a task until a future date so it stops appearing until then.",
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

  const [tasks, exclusions] = await Promise.all([
    prisma.task.findMany({
      where: { status: "open" },
      orderBy: [{ priority: "asc" }, { deadline: "asc" }],
      select: { id: true, title: true, priority: true, deadline: true, projectLabel: true, description: true, createdAt: true },
    }),
    prisma.exclusionRule.findMany({ select: { pattern: true }, take: 20 }),
  ]);

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

  const system = `You are a smart productivity assistant for Rakshit Naik, a senior Product Manager at Capillary Tech.

TODAY: ${today.toISOString().slice(0, 10)}

OPEN TASKS (${tasks.length} total):
${taskList || "No open tasks."}

ACTIVE EXCLUSION RULES:
${exclusions.map(e => `- ${e.pattern}`).join("\n") || "None"}

You can:
- Answer questions about the task list (what's overdue, what to focus on, breakdowns by project/priority)
- Create new tasks the user mentions ("add a task to call Ankit tomorrow")
- Add exclusion rules when the user says they don't want certain tasks to appear in future syncs ("never show me FTP alerts again", "exclude automated reports")
- Mark tasks as done or snooze them

RULES:
- When asked what to work on first: overdue tasks > critical > high priority > earliest deadline
- When user says "never show me X" or "exclude X": use add_exclusion_rule
- Be concise. Use bullet points for lists. No filler phrases.
- When you create a task or exclusion rule, confirm it with a short message.`;

  const apiMessages: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

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
