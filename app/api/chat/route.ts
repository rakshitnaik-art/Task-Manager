import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { message } = await req.json();
  if (!message?.trim()) return Response.json({ error: "Empty message" }, { status: 400 });

  const today = new Date().toISOString().split("T")[0];

  const prompt = `You are a task extraction assistant for a Product Manager. The user has typed or pasted the following into a task input. Extract one or more actionable tasks from it.

Today's date: ${today}

INPUT:
${message}

Rules:
- If the input describes one task, return one task
- If it's a meeting note or long text, extract multiple tasks if needed
- priority: "critical" (due today/blocking), "high" (this week), "medium" (soon), "low" (someday)
- deadline: ISO date string if a date is mentioned or implied, otherwise omit
- source: always "manual"

Return a JSON array of tasks:
[{ "title": "...", "description": "...", "priority": "...", "impact": "...", "deadline": "..." }]

Return ONLY valid JSON, no markdown.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: Array<{ title: string; description?: string; priority?: string; impact?: string; deadline?: string }> = [];
  try {
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) parsed = [parsed];
  } catch {
    return Response.json({ error: "Could not parse tasks" }, { status: 500 });
  }

  const created = await Promise.all(
    parsed.map((t) =>
      prisma.task.create({
        data: {
          title: t.title,
          description: t.description || null,
          priority: t.priority || "medium",
          impact: t.impact || null,
          deadline: t.deadline ? new Date(t.deadline) : null,
          source: "manual",
          rawContext: message,
        },
      })
    )
  );

  return Response.json(created);
}
