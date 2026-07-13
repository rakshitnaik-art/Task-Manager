import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractedTask {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  impact: string;
  deadline?: string;
  source: string;
  sourceRef?: string;
  rawContext?: string;
}

export interface CallMapping {
  taskTitle?: string;
  taskId?: string;
  confidence: number;
  notes: string;
  needsConfirmation: boolean;
  question?: string;
}

export async function analyzeAndExtractTasks(data: {
  emails: Array<{ id: string; subject: string; from: string; date: string; snippet: string }>;
  events: Array<{ id: string; title: string; start: string; description: string; attendees: string[] }>;
  docs: Array<{ id: string; name: string; type: string; modifiedAt: string; url: string }>;
  slackMessages: Array<{ channel: string; text: string; ts: string; user: string }>;
}): Promise<ExtractedTask[]> {
  const prompt = `You are a productivity assistant for a senior Product Manager. Extract actionable tasks from the data below.

SKIP these — they are noise:
- Pure FYI emails with zero action required
- Automated reports, digests, system alerts, monitoring emails
- Newsletters, marketing, and promotional content
- Routine status updates where nothing is asked of the PM
- Completed items or past-tense updates
- Casual Slack chatter with no ask

INCLUDE these:
- Emails or messages where someone is asking the PM to review, decide, respond, approve, or follow up
- Calendar events that require prep or a deliverable
- Docs/sheets that have open items, comments, or next steps
- Anything with a deadline or a stakeholder waiting on the PM
- Emails where the PM is CC'd but the context implies they own the item

For each task:
- title: verb-first (e.g. "Review Q3 PRD", "Respond to Ankit re: pricing")
- description: what needs to be done and why
- priority: "critical" (today/blocking), "high" (this week, key stakeholder), "medium" (should do soon), "low" (nice to have)
- impact: one-line business impact
- deadline: ISO date string if mentioned, otherwise omit
- source: "email" | "slack" | "doc" | "sheet" | "calendar" (use "slack" if the email is a Slack notification from slack.com)
- sourceRef: message ID or doc ID

DATA:
${JSON.stringify(data, null, 2)}

Return a JSON array. Max 15 tasks. Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a precise task extraction assistant. Return only valid JSON.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ExtractedTask[];
  } catch {
    return [];
  }
}

export async function mapCallToTasks(
  call: { title: string; summary?: string; transcript?: string; attendees?: string[] },
  existingTasks: Array<{ id: string; title: string; description?: string | null }>
): Promise<CallMapping> {
  const prompt = `You are a Product Manager's assistant. Map this meeting to one of the existing tasks, or say it doesn't match.

MEETING:
Title: ${call.title}
Summary: ${call.summary || "No summary"}
Attendees: ${(call.attendees || []).join(", ") || "Unknown"}
Transcript excerpt: ${call.transcript?.slice(0, 1000) || "No transcript"}

EXISTING TASKS:
${existingTasks.map((t, i) => `${i + 1}. [${t.id}] ${t.title}: ${t.description || ""}`).join("\n")}

If you can confidently match (confidence > 0.7), return the task ID and your notes.
If unsure (confidence 0.4-0.7), set needsConfirmation to true and ask a specific question.
If no match (confidence < 0.4), return null taskId.

Return JSON: { taskId: string|null, confidence: number, notes: string, needsConfirmation: boolean, question?: string }
Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as CallMapping;
  } catch {
    return { taskId: undefined, confidence: 0, notes: "Could not parse response", needsConfirmation: true };
  }
}

export async function collateTaskContext(
  tasks: ExtractedTask[],
  slackMessages: Array<{ channel: string; text: string; ts: string; user: string }>,
  meetings: Array<{ title: string; summary?: string; transcript?: string; startedAt: string; attendees?: string[] }>
): Promise<ExtractedTask[]> {
  if (tasks.length === 0) return tasks;
  if (slackMessages.length === 0 && meetings.length === 0) return tasks;

  const prompt = `You are a Product Manager's assistant. You have a list of tasks extracted from emails, and additional context from Slack messages and meeting notes.

For each task, find any Slack messages or meeting notes that are related to it (by topic, project name, people involved, or keywords). Merge that context into the task's description to give a fuller picture of what's needed and what has already been discussed.

TASKS:
${JSON.stringify(tasks.map((t, i) => ({ index: i, title: t.title, description: t.description, source: t.source })), null, 2)}

SLACK MESSAGES (last 7 days):
${JSON.stringify(slackMessages.slice(0, 50), null, 2)}

MEETING NOTES (last 14 days):
${JSON.stringify(meetings.map((m) => ({ title: m.title, startedAt: m.startedAt, attendees: m.attendees, summary: m.summary, transcript: m.transcript?.slice(0, 800) })), null, 2)}

Return a JSON array with one entry per task (same order, same index). For each:
- index: the task index
- description: enriched description combining the original + any relevant Slack/meeting context. If nothing related was found, return the original description unchanged.
- rawContext: a brief summary of what was found across sources (e.g. "Email thread started X. Discussed on Slack in #channel. Covered in meeting Y on date Z.")

Return ONLY valid JSON array like: [{ "index": 0, "description": "...", "rawContext": "..." }, ...]
No markdown.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a precise context aggregation assistant. Return only valid JSON.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const enriched: Array<{ index: number; description: string; rawContext: string }> = JSON.parse(cleaned);

    return tasks.map((task, i) => {
      const match = enriched.find((e) => e.index === i);
      if (!match) return task;
      return { ...task, description: match.description, rawContext: match.rawContext };
    });
  } catch {
    return tasks;
  }
}

export async function generateDailySummary(tasks: ExtractedTask[]): Promise<string> {
  const today = tasks.filter((t) => t.priority === "critical" || t.priority === "high");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Write a brief daily briefing (3-4 sentences) for a Product Manager based on these priority tasks: ${JSON.stringify(today)}. Be direct and action-oriented.`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

export async function learnExclusionRule(title: string, rawContext?: string | null): Promise<{ pattern: string; intent: string; keywords: string[] }> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `A Product Manager deleted this task because it was noise they don't want to see.

Task title: "${title}"
Context: ${rawContext?.slice(0, 500) || "none"}

Extract a reusable exclusion rule. Return JSON:
{ "pattern": "one sentence describing what type of content to exclude", "intent": "why this is noise for a PM", "keywords": ["keyword1", "keyword2"] }

Return ONLY valid JSON, no markdown.`
    }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  try {
    return JSON.parse(text.replace(/\`\`\`json\n?/g, "").replace(/\`\`\`\n?/g, "").trim());
  } catch {
    return { pattern: title, intent: "user deleted this task", keywords: title.toLowerCase().split(" ").slice(0, 5) };
  }
}

export async function checkExclusionRules(tasks: ExtractedTask[], rules: Array<{ pattern: string; keywords: string }>): Promise<ExtractedTask[]> {
  if (rules.length === 0) return tasks;

  const keywordSets = rules.map(r => {
    try { return JSON.parse(r.keywords) as string[]; } catch { return r.keywords.split(",").map(k => k.trim()); }
  });

  return tasks.filter(task => {
    const titleLower = task.title.toLowerCase();
    const descLower = (task.description || "").toLowerCase();
    for (const keywords of keywordSets) {
      const matchCount = keywords.filter(k => titleLower.includes(k.toLowerCase()) || descLower.includes(k.toLowerCase())).length;
      if (matchCount >= Math.max(1, Math.floor(keywords.length * 0.4))) return false;
    }
    return true;
  });
}

export async function deduplicateTasks(newTasks: ExtractedTask[], existingTitles: string[]): Promise<ExtractedTask[]> {
  if (existingTitles.length === 0) return newTasks;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Remove duplicates from the new tasks list. A task is a duplicate if it is semantically equivalent to an existing task (same action, same subject).

EXISTING TASKS:
${existingTitles.slice(0, 30).map((t, i) => `${i}. ${t}`).join("\n")}

NEW TASKS:
${newTasks.map((t, i) => `${i}. ${t.title}`).join("\n")}

Return a JSON array of indices from NEW TASKS that are NOT duplicates. Example: [0, 2, 4]
Return ONLY valid JSON array, no markdown.`
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";
  try {
    const keep = JSON.parse(text.replace(/\`\`\`json\n?/g, "").replace(/\`\`\`\n?/g, "").trim()) as number[];
    return keep.map(i => newTasks[i]).filter(Boolean);
  } catch {
    return newTasks;
  }
}

export async function groupTasksByProject(
  tasks: Array<{ id: string; title: string; description?: string | null }>
): Promise<Array<{ id: string; projectLabel: string | null }>> {
  if (tasks.length === 0) return [];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "You are a precise task grouping assistant. Return only valid JSON.",
    messages: [{
      role: "user",
      content: `Group these tasks into projects or initiatives. Tasks about the same product, client, feature, or initiative should share a project label.

Rules:
- Label must be short (2–4 words), title case. Examples: "Beacon Migration", "Comcast Onboarding", "Q3 Planning"
- Only create a group if 2+ tasks clearly belong together
- Standalone tasks get null
- Be specific — "Beacon Migration" beats "Migration"

TASKS:
${tasks.map(t => `[${t.id}] ${t.title}: ${(t.description || "").slice(0, 120)}`).join("\n")}

Return JSON array: [{ "id": "...", "projectLabel": "Label" | null }]
Return ONLY valid JSON, no markdown.`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as Array<{ id: string; projectLabel: string | null }>;
  } catch {
    return [];
  }
}

export function reprioritizeTasks(tasks: Array<{ id: string; priority: string; deadline: Date | null; createdAt: Date }>): Array<{ id: string; newPriority: string }> {
  const now = new Date();
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  return tasks.map(task => {
    if (task.deadline) {
      const diff = task.deadline.getTime() - now.getTime();
      if (diff <= twoDays) return { id: task.id, newPriority: "critical" };
      if (diff <= sevenDays) return { id: task.id, newPriority: "high" };
    } else {
      const age = now.getTime() - task.createdAt.getTime();
      if (age > thirtyDays && task.priority === "low") return { id: task.id, newPriority: "low" };
      if (age > thirtyDays && task.priority === "medium") return { id: task.id, newPriority: "low" };
    }
    return { id: task.id, newPriority: task.priority };
  });
}
