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
  confidence?: number;
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
  emails: Array<{
    id: string; subject: string; from: string; date: string; snippet: string;
    body?: string; messageCount?: number; needsFollowUp?: boolean;
    daysSinceLastMsg?: number; lastSender?: string;
    isCC?: boolean; mentionedInBody?: boolean;
  }>;
  events: Array<{
    id: string; title: string; start: string; description: string; attendees: string[];
    isOrganizer?: boolean; hasActionItems?: boolean;
  }>;
  docs: Array<{ id: string; name: string; type: string; modifiedAt: string; url: string }>;
  slackMessages: Array<{ channel: string; text: string; ts: string; user: string }>;
  recentDoneTasks?: string[];
}): Promise<ExtractedTask[]> {
  const prompt = `You are a productivity assistant for Rakshit Naik, a senior Product Manager at Capillary Tech.

Extract actionable tasks. For EVERY task you extract, assign a confidence score (0.0–1.0) representing how certain you are this requires PM action. Only include tasks with confidence >= 0.65.

=== HARD FILTERS — skip immediately ===
- Automated reports, system alerts, monitoring, FTP/cron/cluster alerts, digest emails
- Newsletters, marketing, promotional content
- Completed items or past-tense updates
- Casual Slack chatter with no clear ask
- Calendar events where isOrganizer=false AND hasActionItems=false — never create a task for these (e.g. "1:1 with X", standard standups, no-prep meetings)

=== ACTION SIGNAL REQUIREMENT ===
Before creating a task from an email or Slack message, it MUST contain at least ONE of:
- A direct question to the PM ("can you", "could you", "would you", "do you think", "what do you")
- An explicit request verb ("please review", "please approve", "please respond", "need you to", "requesting your")
- A deadline mentioned alongside an ask
- A direct mention by name in a CC'd email: "Rakshit" or "+Rakshit"
If NONE of these signals are present, confidence must be < 0.65 — drop it.

=== CC vs TO RULES ===
- isCC=false (you are in To): normal bar — extract tasks if there's an action signal
- isCC=true, mentionedInBody=true: include if there's an action signal — someone explicitly called you out
- isCC=true, mentionedInBody=false: SKIP. You were CC'd for awareness only. Do NOT create a task.

=== CALENDAR RULES ===
- isOrganizer=true OR hasActionItems=true: eligible for a prep/action task if meaningful
- isOrganizer=false AND hasActionItems=false: SKIP — no task needed (e.g. "1:1 with X")
- Recurring standups appearing 4+ times/week: SKIP

=== PRIORITY RULES ===
1. "critical" — deadline within 2 days, OR contains: urgent, ASAP, blocking, by EOD, P0, immediately, escalated
2. "high" — deadline within 7 days, OR key stakeholder waiting, OR needsFollowUp=true
3. "medium" — should do this week, no hard deadline
4. "low" — nice to have, no urgency

=== RECURRING TASK DETECTION ===
If recentDoneTasks lists something semantically identical (same action + same subject), skip it unless it's clearly a new occurrence (5+ days gap), in which case include with a note.

=== OUTPUT FORMAT per task ===
- title: verb-first ("Review Q3 PRD", "Respond to Ankit re: pricing")
- description: what needs doing and why — use full body, not just snippet
- priority: per rules above
- impact: one-line business impact
- confidence: 0.0–1.0 (your certainty this requires PM action)
- deadline: ISO date if mentioned, otherwise omit
- source: "email" | "slack" | "doc" | "sheet" | "calendar"
- sourceRef: thread ID or doc ID

DATA:
${JSON.stringify(data, null, 2)}

Return a JSON array. Max 20 tasks. Include ONLY tasks with confidence >= 0.65. Return ONLY valid JSON, no markdown.`;

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
      content: `Remove duplicates from the new tasks list. A task is a duplicate if it meets ANY of these conditions:
- Semantically equivalent to an existing task (same action, same subject)
- About the same ticket/issue ID (e.g. CAP-195904, PSV-123) as an existing task — even if the action is slightly different
- Clearly a subset or follow-on step of an existing task about the same entity

When multiple NEW TASKS are about the same ticket/entity, keep only the most comprehensive one (most detail, highest priority).

EXISTING TASKS:
${existingTitles.slice(0, 30).map((t, i) => `${i}. ${t}`).join("\n")}

NEW TASKS:
${newTasks.map((t, i) => `${i}. ${t.title}`).join("\n")}

Return a JSON array of indices from NEW TASKS that are NOT duplicates (keep only one per ticket/entity). Example: [0, 2, 4]
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

export async function collapseRelatedTasks(tasks: ExtractedTask[]): Promise<ExtractedTask[]> {
  if (tasks.length <= 1) return tasks;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a precise task consolidation assistant. Return only valid JSON.",
    messages: [{
      role: "user",
      content: `You have tasks extracted from emails, sheets, and calendar. Many are about the same issue phrased differently — active vs passive voice, different angles on the same thread, multiple updates on the same ticket.

Collapse related tasks into single comprehensive tasks.

COLLAPSE when tasks share ANY of:
- Same ticket/issue ID (CAP-xxx, PSV-xxx, JIRA-xxx, etc.)
- Same client + same core action ("confirm Hertz X" + "follow up on Hertz X" + "check Hertz X" = one task)
- Active/passive variations of the same ask ("Review PSV-15212" + "Check PSV-15212 for PM action" = one)
- Same sheet being reviewed for different sub-reasons (merge into one review task)

When collapsing:
- Write a single verb-first title that captures the full scope
- Merge descriptions to include all angles and context
- Use the HIGHEST priority of the group
- Use the EARLIEST deadline if any exist
- Use the source of the most informative task

TASKS (index: title):
${tasks.map((t, i) => `${i}. [${t.priority}] [${t.source}] ${t.title}\n   ${(t.description || "").slice(0, 200)}`).join("\n\n")}

Return a JSON array. Each element is a final task with fields: title, description, priority, impact, source, sourceRef, deadline (optional).
Do NOT include tasks that were merged into another — only include the collapsed result.
Return ONLY valid JSON array, no markdown.`,
    }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ExtractedTask[];
  } catch {
    return tasks;
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

export function reprioritizeTasks(tasks: Array<{ id: string; priority: string; deadline: Date | null; createdAt: Date; title: string; description?: string | null }>): Array<{ id: string; newPriority: string }> {
  const now = new Date();
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const urgentKeywords = ['urgent', 'asap', 'blocking', 'by eod', 'end of day', 'critical', 'immediately', 'stat', 'p0', 'escalated'];
  const priorityBump: Record<string, string> = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' };

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
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    if (urgentKeywords.some(k => text.includes(k))) {
      return { id: task.id, newPriority: priorityBump[task.priority] || task.priority };
    }
    return { id: task.id, newPriority: task.priority };
  });
}
