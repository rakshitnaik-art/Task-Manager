"use client";

import { useEffect, useState, useCallback } from "react";
import TaskCard from "@/components/TaskCard";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
  impact?: string | null;
  deadline?: string | null;
  source: string;
  status: string;
}

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

export default function WeekPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchTasks = useCallback(async () => {
    const res = await fetch("/api/tasks?view=week");
    const data = await res.json();
    setTasks(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleDone = async (id: string) => {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const sources = ["all", ...Array.from(new Set(tasks.map((t) => t.source)))];
  const filtered = filter === "all" ? tasks : tasks.filter((t) => t.source === filter);
  const sorted = [...filtered].sort(
    (a, b) =>
      (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4) -
      (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4)
  );

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">This Week</h1>
        <p className="text-zinc-500 text-sm mt-1">All open tasks for the next 7 days, ranked by priority</p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {sources.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
              filter === s ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-lg font-medium text-zinc-400">No tasks this week</p>
          <p className="text-sm mt-1">Sync from the Today view to pull in new tasks</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((t) => <TaskCard key={t.id} task={t} onDone={handleDone} onDelete={() => {}} onUpdate={() => {}} onSnooze={() => {}} />)}
        </div>
      )}
    </div>
  );
}
