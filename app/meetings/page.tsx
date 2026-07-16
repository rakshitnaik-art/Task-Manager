"use client";

import { useState, useEffect, useCallback } from "react";
import { format, parseISO, isValid } from "date-fns";

interface Meeting {
  id: string;
  title: string;
  created_at: string;
  summary_status?: string;
}

interface TranscriptRow {
  id: string;
  transcript: string;
  timestamp?: string;
  summary?: string;
  action_items?: string;
  audio_start_time?: number;
}

interface MeetingSummary {
  status: string | null;
  text: string;
  actionItems: string[];
  keyPoints: string[];
}

interface MeetingDetail {
  meeting: Meeting;
  transcripts: TranscriptRow[];
  summary: MeetingSummary;
}

function formatDate(raw: string) {
  try {
    const d = parseISO(raw);
    return isValid(d) ? format(d, "MMM d, yyyy · h:mm a") : raw;
  } catch { return raw; }
}

function formatTimestamp(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StatusDot({ status }: { status?: string | null }) {
  if (status === "completed") return <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />;
  if (status === "processing") return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  return null;
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addedItems, setAddedItems] = useState<Set<string>>(new Set());
  const [addingAll, setAddingAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/meetings")
      .then(r => r.json())
      .then(data => {
        if (data.error === "meetily_not_installed") { setNotInstalled(true); return; }
        const list: Meeting[] = data.meetings ?? [];
        setMeetings(list);
        if (list.length > 0) loadDetail(list[0].id);
      })
      .catch(() => setNotInstalled(true))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    setAddedItems(new Set());
    try {
      const res = await fetch(`/api/meetings?id=${id}`);
      const data = await res.json();
      if (!data.error) setDetail(data);
    } catch {}
    setDetailLoading(false);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const addItemAsTask = async (item: string) => {
    if (!detail) return;
    setAddedItems(prev => new Set([...prev, item]));
    await fetch("/api/meetings/create-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingTitle: detail.meeting.title, actionItems: [item] }),
    });
    showToast("Task added to Today view");
  };

  const addAllAsTask = async () => {
    if (!detail || !detail.summary.actionItems.length) return;
    const remaining = detail.summary.actionItems.filter(i => !addedItems.has(i));
    if (!remaining.length) return;
    setAddingAll(true);
    setAddedItems(prev => new Set([...prev, ...remaining]));
    await fetch("/api/meetings/create-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingTitle: detail.meeting.title, actionItems: remaining }),
    });
    showToast(`${remaining.length} task${remaining.length !== 1 ? "s" : ""} added to Today view`);
    setAddingAll(false);
  };

  const filtered = meetings.filter(m =>
    !search || (m.title ?? "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading Meetily…</div>
      </div>
    );
  }

  if (notInstalled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-5xl">🎙️</div>
        <h2 className="text-white text-xl font-semibold">Meetily not running</h2>
        <p className="text-zinc-400 text-sm max-w-sm leading-relaxed">
          Open <strong>Meetily</strong> from your Applications folder and record a meeting.
          Your transcripts and AI summaries will appear here automatically.
        </p>
        <button
          onClick={() => { window.location.reload(); }}
          className="mt-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium transition-colors border border-zinc-700"
        >
          Refresh
        </button>
        <p className="text-zinc-600 text-xs">
          Meetily is installed at /Applications/meetily.app
        </p>
      </div>
    );
  }

  if (!loading && meetings.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-5xl">🎙️</div>
        <h2 className="text-white text-lg font-semibold">No meetings yet</h2>
        <p className="text-zinc-400 text-sm max-w-xs">
          Open Meetily, record a meeting, and it will appear here with an AI summary.
          Action items will be one click away from becoming tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Toast */}
      {toast && (
        <div className="absolute top-4 right-4 z-50 px-4 py-2 bg-green-600 text-white text-sm rounded-lg shadow-lg">
          ✓ {toast}
        </div>
      )}

      {/* Left: meeting list */}
      <div className="w-64 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-white font-semibold text-sm">Meetings</h1>
            <span className="text-xs text-zinc-600">via Meetily</span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-zinc-600 text-xs p-4">No meetings match.</p>
          ) : filtered.map(m => (
            <button
              key={m.id}
              onClick={() => loadDetail(m.id)}
              className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800 transition-colors ${selectedId === m.id ? "bg-zinc-800 border-l-2 border-l-indigo-500" : ""}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <StatusDot status={m.summary_status} />
                <p className="text-xs font-medium text-white truncate">{m.title || "Untitled Meeting"}</p>
              </div>
              <p className="text-xs text-zinc-500">{formatDate(m.created_at)}</p>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-zinc-800 shrink-0">
          <button
            onClick={() => fetch("/api/meetings/open", { method: "POST" })}
            className="w-full text-xs py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
          >
            Open Meetily →
          </button>
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {detailLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-zinc-500 text-sm animate-pulse">Loading…</div>
          </div>
        )}

        {!detailLoading && detail && (
          <div className="max-w-2xl">
            {/* Header */}
            <h2 className="text-white text-xl font-bold mb-1">
              {detail.meeting.title || "Untitled Meeting"}
            </h2>
            <p className="text-zinc-500 text-xs mb-5">{formatDate(detail.meeting.created_at)}</p>

            {/* Summary */}
            {detail.summary.text && (
              <div className="mb-5 p-4 rounded-xl bg-indigo-600/10 border border-indigo-600/20">
                <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Summary</p>
                <p className="text-sm text-zinc-200 leading-relaxed">{detail.summary.text}</p>
              </div>
            )}

            {/* Action Items — the core integration */}
            {detail.summary.actionItems.length > 0 && (
              <div className="mb-5 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Action Items</p>
                  <button
                    onClick={addAllAsTask}
                    disabled={addingAll || detail.summary.actionItems.every(i => addedItems.has(i))}
                    className="text-xs px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
                  >
                    {detail.summary.actionItems.every(i => addedItems.has(i)) ? "All added ✓" : "Add all to Tasks"}
                  </button>
                </div>
                <ul className="space-y-2">
                  {detail.summary.actionItems.map((item, i) => {
                    const added = addedItems.has(item);
                    return (
                      <li key={i} className="flex items-start gap-3">
                        <button
                          onClick={() => !added && addItemAsTask(item)}
                          disabled={added}
                          className={`shrink-0 mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                            added
                              ? "bg-green-600 border-green-600 text-white"
                              : "border-amber-400/50 hover:border-indigo-400 hover:bg-indigo-600/20 text-transparent hover:text-indigo-400"
                          }`}
                          title={added ? "Added to tasks" : "Add as task"}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <span className={`text-sm leading-relaxed ${added ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                          {item}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Key Points */}
            {detail.summary.keyPoints.length > 0 && (
              <div className="mb-5 p-4 rounded-xl bg-zinc-800 border border-zinc-700">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Key Points</p>
                <ul className="space-y-1.5">
                  {detail.summary.keyPoints.map((pt, i) => (
                    <li key={i} className="text-sm text-zinc-300 flex gap-2">
                      <span className="text-zinc-500 shrink-0">·</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* No summary yet */}
            {!detail.summary.text && !detail.summary.actionItems.length && detail.summary.status !== "completed" && (
              <div className="mb-5 p-4 rounded-xl bg-zinc-800/60 border border-zinc-700 text-center">
                <p className="text-zinc-400 text-sm mb-1">
                  {detail.summary.status === "processing" ? "⟳ Meetily is generating the AI summary…" : "No summary yet"}
                </p>
                <p className="text-zinc-600 text-xs">
                  Open Meetily and generate a summary to see action items here.
                </p>
              </div>
            )}

            {/* Transcript */}
            {detail.transcripts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Transcript</p>
                <div className="space-y-2">
                  {detail.transcripts.map((seg, i) => (
                    <div key={seg.id ?? i} className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/40">
                      {seg.audio_start_time != null && (
                        <p className="text-xs font-mono text-zinc-600 mb-1">{formatTimestamp(seg.audio_start_time)}</p>
                      )}
                      <p className="text-sm text-zinc-200 leading-relaxed">{seg.transcript}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
