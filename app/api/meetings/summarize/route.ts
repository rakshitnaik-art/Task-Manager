import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY || getSettings().anthropicKey;
  return new Anthropic({ apiKey: key });
}

export async function POST(req: NextRequest) {
  const { meetingId } = await req.json();
  if (!meetingId) return Response.json({ error: "meetingId required" }, { status: 400 });

  const transcripts = await prisma.$queryRaw<Array<{ text: string }>>`
    SELECT text FROM "LocalTranscript"
    WHERE meetingId = ${meetingId}
    ORDER BY sequence ASC, createdAt ASC
  `;

  if (!transcripts.length) {
    return Response.json({ error: "no_transcript" }, { status: 400 });
  }

  const fullText = transcripts.map(t => t.text).join(" ");

  const anthropic = getAnthropic();
  const settings = getSettings();
  const userLine = settings.userName
    ? `a Product Manager (${settings.userName})`
    : `a Product Manager`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are summarizing a meeting transcript for ${userLine}.

TRANSCRIPT:
${fullText}

Respond with a JSON object only (no markdown, no code blocks). Use this exact structure:
{
  "title": "Short descriptive meeting title (5-8 words)",
  "summary": "2-3 sentence overview of what was discussed",
  "actionItems": ["action item 1", "action item 2"],
  "keyPoints": ["key point 1", "key point 2"],
  "decisions": ["decision 1", "decision 2"]
}

Keep each list to 3-5 items max. Be specific and concise. If a section has nothing relevant, return an empty array.`,
      },
    ],
  });

  const text = response.content.find(b => b.type === "text")?.text ?? "{}";

  let parsed: {
    title?: string;
    summary?: string;
    actionItems?: string[];
    keyPoints?: string[];
    decisions?: string[];
  } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* leave empty */ }
    }
  }

  const now = new Date().toISOString();

  if (parsed.title) {
    await prisma.$executeRaw`
      UPDATE "LocalMeeting" SET title = ${parsed.title}, updatedAt = ${now} WHERE id = ${meetingId}
    `;
  }

  await prisma.$executeRaw`
    UPDATE "LocalMeeting"
    SET summary = ${parsed.summary ?? null},
        actionItems = ${parsed.actionItems?.length ? JSON.stringify(parsed.actionItems) : null},
        keyPoints = ${parsed.keyPoints?.length ? JSON.stringify(parsed.keyPoints) : null},
        decisions = ${parsed.decisions?.length ? JSON.stringify(parsed.decisions) : null},
        status = 'done',
        updatedAt = ${now}
    WHERE id = ${meetingId}
  `;

  return Response.json({ ok: true, ...parsed });
}
