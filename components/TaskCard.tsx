"use client";

import { useState } from "react";
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
}

interface Props {
  task: Task;
  onDone: (id: string) => void;
  onDelete: (id: string, learnedRule?: string) => void;
  onUpdate: (updated: Task) => void;
  onSnooze: (id: string) => void;
}

const priorityConfig = {
  critical: { label: "Critical", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500", text: "text-red-400" },
  high: { label: "High", bg: "bg-orange-500/10", border: "border-orange-500/30", dot: "bg-orange-400", text: "text-orange-400" },
  medium: { label: "Medium", bg: "bg-yellow-500/10", border: "border-yellow-500/30", dot: "bg-yellow-400", text: "text-yellow-400" },
  low: { label: "Low", bg: "bg-zinc-700/30", border: "border-zinc-700", dot: "bg-zinc-500", text: "text-zinc-400" },
};

const labelColors = ["bg-blue-500/20 text-blue-300", "bg-purple-500/20 text-purple-300", "bg-teal-500/20 text-teal-300", "bg-pink-500/20 text-pink-300", "bg-amber-500/20 text-amber-300"];

function labelColor(label: string) {
  let hash = 0;
  for (const c of label) hash = (hash * 31 + c.charCodeAt(0)) % labelColors.length;
  return labelColors[hash];
}

const sourceIcon: Record<string, string> = { email: "✉️", slack: "💬", doc: "📄", sheet: "📊", calendar: "📅", granola: "🎙️", manual: "✏️" };

export default function TaskCard({ task, onDone, onDelete, onUpdate, onSnooze }: Props) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [expanded, setExpanded] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editTitle, setEditTitle] = useState(task.title);
  const [editPriority, setEditPriority] = useState(task.priority);
  const [editDeadline, setEditDeadline] = useState(task.deadline ? task.deadline.slice(0, 10) : "");
  const [editLabel, setEditLabel] = useState(task.projectLabel || "");
  const [editDescription, setEditDescription] = useState(task.description || "");

  const p = priorityConfig[task.priority as keyof typeof priorityConfig] || priorityConfig.low;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: task.id,
          title: editTitle,
          priority: editPriority,
          deadline: editDeadline || null,
          projectLabel: editLabel || null,
          description: editDescription,
        }),
      });
      const updated = await res.json();
      onUpdate({ ...task, ...updated });
      setMode("view");
    } finally {
      setSaving(false);
    }
  };

  const handleSnooze = async (until: "tomorrow" | "next-week") => {
    setShowSnooze(false);
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, snoozedUntil: until }),
    });
    onSnooze(task.id);
    showToast(until === "tomorrow" ? "Snoozed until tomorrow" : "Snoozed until next week");
  };

  const handleDelete = async () => {
    const res = await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id }),
    });
    const data = await res.json();
    onDelete(task.id, data.learnedRule);
    if (data.learnedRule) showToast(`Learned: "${data.learnedRule}"`);
  };

  return (
    <div className={`relative rounded-xl border p-4 ${p.bg} ${p.border} transition-all`}>
      {toast && (
        <div className="absolute -top-8 left-0 right-0 text-center text-xs text-indigo-300 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 z-10">
          {toast}
        </div>
      )}

      {mode === "edit" ? (
        <div className="space-y-2">
          <input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <textarea
            value={editDescription}
            onChange={e => setEditDescription(e.target.value)}
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 resize-none"
          />
          <div className="flex gap-2 flex-wrap">
            <select
              value={editPriority}
              onChange={e => setEditPriority(e.target.value)}
              className="bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
            >
              {["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input
              type="date"
              value={editDeadline}
              onChange={e => setEditDeadline(e.target.value)}
              className="bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
            />
            <input
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              placeholder="Project label..."
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setMode("view")} className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${p.text} bg-black/20`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />
                  {p.label}
                </span>
                <span className="text-xs text-zinc-500">{sourceIcon[task.source] || "•"} {task.source}</span>
                {task.projectLabel && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${labelColor(task.projectLabel)}`}>
                    {task.projectLabel}
                  </span>
                )}
              </div>

              <h3 className="font-semibold text-white text-sm leading-snug mb-1.5">{task.title}</h3>

              {task.description && (
                <p className={`text-zinc-400 text-xs leading-relaxed mb-2 ${expanded ? "" : "line-clamp-2"}`}>
                  {task.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                {task.impact && <span className="flex items-center gap-1"><span className="text-indigo-400">⚡</span>{task.impact}</span>}
                {task.deadline && <span className="flex items-center gap-1">🗓️ {format(new Date(task.deadline), "MMM d")}</span>}
                {task.rawContext && (
                  <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-zinc-600 hover:text-zinc-400 transition-colors">
                    {expanded ? "▲ Hide context" : "▼ Show context"}
                  </button>
                )}
              </div>

              {expanded && task.rawContext && (
                <div className="mt-3 p-3 bg-zinc-900/80 rounded-lg border border-zinc-700 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {task.rawContext}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Snooze */}
              <div className="relative">
                <button
                  onClick={() => setShowSnooze(!showSnooze)}
                  className="w-6 h-6 rounded-full border border-zinc-700 hover:border-indigo-500 hover:bg-indigo-500/10 transition-colors flex items-center justify-center text-zinc-600 hover:text-indigo-400 text-xs"
                  title="Snooze"
                >⏰</button>
                {showSnooze && (
                  <div className="absolute right-0 top-8 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-20 w-36 text-xs overflow-hidden">
                    <button onClick={() => handleSnooze("tomorrow")} className="w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300">Tomorrow</button>
                    <button onClick={() => handleSnooze("next-week")} className="w-full px-3 py-2 text-left hover:bg-zinc-800 text-zinc-300">Next week</button>
                  </div>
                )}
              </div>
              {/* Edit */}
              <button
                onClick={() => setMode("edit")}
                className="w-6 h-6 rounded-full border border-zinc-700 hover:border-blue-500 hover:bg-blue-500/10 transition-colors flex items-center justify-center text-zinc-600 hover:text-blue-400 text-xs"
                title="Edit"
              >✎</button>
              {/* Done */}
              <button
                onClick={() => onDone(task.id)}
                className="w-6 h-6 rounded-full border border-zinc-600 hover:border-green-500 hover:bg-green-500/10 transition-colors flex items-center justify-center text-zinc-600 hover:text-green-400 text-xs"
                title="Mark done"
              >✓</button>
              {/* Delete */}
              <button
                onClick={handleDelete}
                className="w-6 h-6 rounded-full border border-zinc-700 hover:border-red-500 hover:bg-red-500/10 transition-colors flex items-center justify-center text-zinc-700 hover:text-red-400 text-xs"
                title="Delete (learns pattern)"
              >✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
