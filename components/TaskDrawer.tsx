"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
  impact?: string | null;
  deadline?: string | null;
  source: string;
  status: string;
  rawContext?: string | null;
  projectLabel?: string | null;
  blockedReason?: string | null;
  createdAt?: string;
}

interface Link { url: string; label: string; }
interface ProjectDoc { url: string | null; title: string | null; note: string | null; }
interface RelatedCall {
  id: string; title: string; startedAt: string;
  summary?: string | null; transcript?: string | null;
  attendees: string[]; notes?: string | null; confidence?: number | null;
}

interface DetailData {
  task: Task;
  extractedLinks: Link[];
  projectDocs: ProjectDoc[];
  relatedCalls: RelatedCall[];
}

const priorityColors: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  low: "text-zinc-400 bg-zinc-700/30 border-zinc-700",
};

const statusColors: Record<string, string> = {
  open: "text-zinc-400",
  in_progress: "text-blue-400",
  blocked: "text-amber-400",
  done: "text-green-400",
  closed: "text-zinc-600",
};

const sourceIcon: Record<string, string> = {
  email: "✉️", slack: "💬", doc: "📄", sheet: "📊",
  calendar: "📅", granola: "🎙️", manual: "✏️", chat: "💬",
};

function LinkChip({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors group"
    >
      <span className="text-indigo-400 shrink-0">🔗</span>
      <span className="font-medium shrink-0 text-indigo-300">{label}</span>
      <span className="text-zinc-600 truncate group-hover:text-zinc-400 transition-colors">{url.slice(0, 60)}{url.length > 60 ? "…" : ""}</span>
    </a>
  );
}

export default function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/tasks/${taskId}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [taskId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const task = data?.task;
  const allLinks = [
    ...(data?.extractedLinks || []),
    ...(data?.projectDocs || []).filter(d => d.url).map(d => ({ url: d.url!, label: d.title || "Project Doc" })),
  ];

  // Deduplicate links by URL
  const seenUrls = new Set<string>();
  const uniqueLinks = allLinks.filter(l => {
    if (seenUrls.has(l.url)) return false;
    seenUrls.add(l.url);
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-xl bg-zinc-950 border-l border-zinc-800 h-full overflow-y-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0 sticky top-0 bg-zinc-950 z-10">
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Task Detail</p>
          <button onClick={onClose} className="w-7 h-7 rounded-full border border-zinc-700 hover:border-zinc-500 flex items-center justify-center text-zinc-500 hover:text-white text-sm transition-colors">✕</button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="space-y-3 w-full px-6 pt-6">
              {[1, 2, 3].map(i => <div key={i} className="h-8 rounded-lg bg-zinc-800 animate-pulse" />)}
            </div>
          </div>
        )}

        {!loading && task && (
          <div className="flex-1 px-6 py-5 space-y-6">

            {/* Title + meta */}
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${priorityColors[task.priority] || priorityColors.low}`}>
                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </span>
                {task.status !== "open" && (
                  <span className={`text-xs font-medium ${statusColors[task.status]}`}>
                    {task.status === "in_progress" ? "▶ In Progress" : task.status === "blocked" ? "⊘ Blocked" : task.status}
                  </span>
                )}
                <span className="text-xs text-zinc-500">{sourceIcon[task.source] || "•"} {task.source}</span>
                {task.projectLabel && (
                  <span className="text-xs px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded-full">{task.projectLabel}</span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-white leading-snug">{task.title}</h2>
              {task.deadline && (
                <p className={`text-xs mt-2 font-medium ${new Date(task.deadline) < new Date() ? "text-red-400" : "text-zinc-400"}`}>
                  {new Date(task.deadline) < new Date() ? "⚠️ Overdue · " : "🗓️ Due "}
                  {format(new Date(task.deadline), "EEEE, MMMM d yyyy")}
                </p>
              )}
              {task.blockedReason && (
                <p className="text-xs mt-2 text-amber-400 flex items-start gap-1">
                  <span className="shrink-0">⊘</span>
                  <span><strong>Blocked:</strong> {task.blockedReason}</span>
                </p>
              )}
            </div>

            {/* Description */}
            {task.description && (
              <section>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Description</h3>
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{task.description}</p>
              </section>
            )}

            {/* Impact */}
            {task.impact && (
              <section>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Impact</h3>
                <p className="text-sm text-zinc-400 flex items-start gap-1.5"><span className="text-indigo-400">⚡</span>{task.impact}</p>
              </section>
            )}

            {/* Links — extracted + project docs combined */}
            {uniqueLinks.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Links & Docs <span className="text-zinc-600 font-normal normal-case tracking-normal">({uniqueLinks.length})</span>
                </h3>
                <div className="space-y-1.5">
                  {uniqueLinks.map((link, i) => <LinkChip key={i} url={link.url} label={link.label} />)}
                </div>
              </section>
            )}

            {/* Project reference docs (notes only — no URL) */}
            {(data?.projectDocs || []).filter(d => d.note && !d.url).map((doc, i) => (
              <section key={i}>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Project Note</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">{doc.note}</p>
              </section>
            ))}

            {/* Related meeting notes */}
            {(data?.relatedCalls || []).length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Meeting Notes <span className="text-zinc-600 font-normal normal-case tracking-normal">({data!.relatedCalls.length})</span>
                </h3>
                <div className="space-y-3">
                  {data!.relatedCalls.map(call => (
                    <div key={call.id} className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
                      <p className="text-xs font-medium text-white mb-0.5">{call.title}</p>
                      <p className="text-xs text-zinc-600 mb-2">{format(new Date(call.startedAt), "MMM d yyyy · h:mm a")}</p>
                      {call.attendees?.length > 0 && (
                        <p className="text-xs text-zinc-500 mb-2">With: {call.attendees.join(", ")}</p>
                      )}
                      {call.summary && <p className="text-xs text-zinc-400 leading-relaxed">{call.summary}</p>}
                      {call.notes && <p className="text-xs text-zinc-500 mt-1 italic">{call.notes}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Context summary */}
            {task.rawContext && (
              <section>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Context</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{task.rawContext}</p>
              </section>
            )}

            {task.createdAt && (
              <p className="text-xs text-zinc-700 pt-2 border-t border-zinc-900">
                Created {format(new Date(task.createdAt), "MMM d yyyy · h:mm a")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
