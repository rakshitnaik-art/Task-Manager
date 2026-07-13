// Granola stores meeting notes locally on Mac at ~/Library/Application Support/Granola
// We read them directly without needing an API key.
import fs from "fs";
import path from "path";
import os from "os";

interface GranolaNote {
  id: string;
  title: string;
  startedAt: string;
  duration?: number;
  transcript?: string;
  summary?: string;
  attendees?: string[];
}

function getGranolaDataPath(): string {
  return path.join(os.homedir(), "Library", "Application Support", "Granola");
}

export async function fetchGranolaMeetings(days = 14): Promise<GranolaNote[]> {
  const dataPath = getGranolaDataPath();

  if (!fs.existsSync(dataPath)) {
    return [];
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const results: GranolaNote[] = [];

  try {
    const files = fs.readdirSync(dataPath).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dataPath, file), "utf8");
        const data = JSON.parse(raw);

        // Granola stores notes with different possible structures
        const notes = Array.isArray(data) ? data : data.notes || data.meetings || [data];

        for (const note of notes) {
          const startedAt = note.startedAt || note.started_at || note.createdAt || note.date;
          if (!startedAt) continue;

          const noteDate = new Date(startedAt);
          if (noteDate < cutoff) continue;

          results.push({
            id: note.id || note.uuid || `${file}-${noteDate.getTime()}`,
            title: note.title || note.name || "Untitled Meeting",
            startedAt: noteDate.toISOString(),
            duration: note.duration || note.durationSeconds,
            transcript: note.transcript || note.transcription,
            summary: note.summary || note.notes || note.content,
            attendees: note.attendees || note.participants || [],
          });
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // can't read directory
  }

  return results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function isGranolaInstalled(): boolean {
  return fs.existsSync(getGranolaDataPath());
}
