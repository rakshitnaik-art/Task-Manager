"use client";

import { format } from "date-fns";
import { useState } from "react";

interface Task {
  id: string;
  title: string;
}

interface CallMapping {
  id: string;
  confidence?: number | null;
  confirmed: boolean;
  notes?: string | null;
  task?: Task | null;
}

interface Call {
  id: string;
  title: string;
  startedAt: string;
  duration?: number | null;
  summary?: string | null;
  callMappings: CallMapping[];
}

interface Props {
  call: Call;
  allTasks: Task[];
  onConfirm: (callId: string, taskId: string | null) => void;
}

export default function CallCard({ call, allTasks, onConfirm }: Props) {
  const mapping = call.callMappings[0];
  const [selectedTask, setSelectedTask] = useState(mapping?.task?.id || "");
  const [saving, setSaving] = useState(false);

  const durationMin = call.duration ? Math.round(call.duration / 60) : null;
  const needsConfirm = mapping && !mapping.confirmed;

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm(call.id, selectedTask || null);
    setSaving(false);
  };

  return (
    <div className={`rounded-xl border p-4 transition-all ${needsConfirm ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-700 bg-zinc-800/50"}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-lg shrink-0">
          🎙️
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="font-semibold text-white text-sm truncate">{call.title}</h3>
            <span className="text-xs text-zinc-500 shrink-0">
              {format(new Date(call.startedAt), "MMM d, h:mm a")}
              {durationMin && ` · ${durationMin}m`}
            </span>
          </div>

          {call.summary && (
            <p className="text-zinc-400 text-xs mb-3 line-clamp-2">{call.summary}</p>
          )}

          {mapping && (
            <div className="mt-2">
              {mapping.notes && (
                <p className="text-xs text-zinc-500 mb-2 italic">{mapping.notes}</p>
              )}

              <div className="flex items-center gap-2">
                <select
                  value={selectedTask}
                  onChange={(e) => setSelectedTask(e.target.value)}
                  className="flex-1 text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">No task linked</option>
                  {allTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>

                <button
                  onClick={handleConfirm}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 transition-colors"
                >
                  {saving ? "..." : needsConfirm ? "Confirm" : "Update"}
                </button>
              </div>

              {mapping.confidence !== null && mapping.confidence !== undefined && (
                <p className="text-xs text-zinc-600 mt-1">
                  AI confidence: {Math.round((mapping.confidence || 0) * 100)}%
                  {mapping.confirmed && " · Confirmed"}
                </p>
              )}
            </div>
          )}

          {!mapping && (
            <div className="flex items-center gap-2 mt-2">
              <select
                value={selectedTask}
                onChange={(e) => setSelectedTask(e.target.value)}
                className="flex-1 text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Link to a task...</option>
                {allTasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white font-medium disabled:opacity-50 transition-colors"
              >
                {saving ? "..." : "Link"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
