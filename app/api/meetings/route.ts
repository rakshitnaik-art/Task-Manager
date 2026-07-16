import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import os from "os";
import path from "path";
import fs from "fs";

function getMeetilyPath() {
  return path.join(os.homedir(), "Library", "Application Support", "com.meetily.ai", "meeting_minutes.sqlite");
}

function openClient() {
  const dbPath = getMeetilyPath();
  if (!fs.existsSync(dbPath)) return null;
  return createClient({ url: `file:${dbPath}` });
}

function parseResult(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

function extractActionItems(result: Record<string, unknown>): string[] {
  // Meetily stores action_items as a top-level array or inside a section
  if (Array.isArray(result.action_items)) return result.action_items as string[];
  if (typeof result.action_items === "string") {
    try { return JSON.parse(result.action_items) as string[]; } catch { return [result.action_items]; }
  }
  // BlockNote format: sections keyed by name
  for (const key of Object.keys(result)) {
    const section = result[key] as { blocks?: Array<{ content?: string }> };
    if (key.toLowerCase().includes("action") && Array.isArray(section?.blocks)) {
      return section.blocks.map(b => b.content ?? "").filter(Boolean);
    }
  }
  return [];
}

function extractKeyPoints(result: Record<string, unknown>): string[] {
  if (Array.isArray(result.key_points)) return result.key_points as string[];
  for (const key of Object.keys(result)) {
    const section = result[key] as { blocks?: Array<{ content?: string }> };
    if ((key.toLowerCase().includes("key") || key.toLowerCase().includes("point")) && Array.isArray(section?.blocks)) {
      return section.blocks.map(b => b.content ?? "").filter(Boolean);
    }
  }
  return [];
}

function extractSummary(result: Record<string, unknown>): string {
  if (typeof result.summary === "string") return result.summary;
  if (typeof result.markdown === "string") {
    // Strip markdown headings to get plain text summary
    const lines = result.markdown.split("\n").filter(l => !l.startsWith("#") && l.trim());
    return lines.slice(0, 3).join(" ");
  }
  return "";
}

export async function GET(req: NextRequest) {
  const client = openClient();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!client) {
    return Response.json({ error: "meetily_not_installed", meetings: [] });
  }

  try {
    if (id) {
      const [meetingRes, transcriptsRes, summaryRes] = await Promise.all([
        client.execute({ sql: "SELECT * FROM meetings WHERE id = ?", args: [id] }),
        client.execute({
          sql: "SELECT id, transcript, timestamp, summary, action_items, key_points, audio_start_time, audio_end_time FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC",
          args: [id],
        }),
        client.execute({
          sql: "SELECT status, result FROM summary_processes WHERE meeting_id = ? LIMIT 1",
          args: [id],
        }),
      ]);

      const meeting = meetingRes.rows[0] ?? null;
      if (!meeting) return Response.json({ error: "not_found" }, { status: 404 });

      const summaryRow = summaryRes.rows[0];
      const parsed = parseResult(summaryRow?.result as string ?? null);

      return Response.json({
        meeting,
        transcripts: transcriptsRes.rows,
        summary: {
          status: summaryRow?.status ?? null,
          text: extractSummary(parsed),
          actionItems: extractActionItems(parsed),
          keyPoints: extractKeyPoints(parsed),
          raw: summaryRow?.result ?? null,
        },
      });
    }

    // List all meetings with their summary status
    const meetings = await client.execute(
      "SELECT m.id, m.title, m.created_at, m.updated_at, sp.status as summary_status FROM meetings m LEFT JOIN summary_processes sp ON sp.meeting_id = m.id ORDER BY m.created_at DESC"
    );
    return Response.json({ meetings: meetings.rows });
  } catch (e) {
    return Response.json({ error: "db_error", detail: String(e), meetings: [] });
  } finally {
    client.close();
  }
}
