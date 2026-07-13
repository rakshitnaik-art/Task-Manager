"use client";

import { useEffect, useState, useCallback } from "react";
import CallCard from "@/components/CallCard";

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

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [callsRes, tasksRes] = await Promise.all([
      fetch("/api/calls"),
      fetch("/api/tasks?view=week"),
    ]);
    setCalls(await callsRes.json());
    setTasks(await tasksRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleConfirm = async (callId: string, taskId: string | null) => {
    await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, taskId, confirmed: true }),
    });
    await fetchData();
  };

  const pending = calls.filter((c) => c.callMappings[0] && !c.callMappings[0].confirmed);
  const confirmed = calls.filter((c) => !c.callMappings[0] || c.callMappings[0].confirmed);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Calls</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Meetings from Granola, mapped to your tasks by Claude
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="text-center py-20 text-zinc-600">
          <p className="text-4xl mb-3">🎙️</p>
          <p className="text-lg font-medium text-zinc-400">No calls yet</p>
          <p className="text-sm mt-1">
            Make sure Granola is installed and has recorded meetings. Hit Sync to pull them in.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-amber-400 uppercase tracking-widest mb-3">
                Needs Confirmation ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map((c) => (
                  <CallCard key={c.id} call={c} allTasks={tasks} onConfirm={handleConfirm} />
                ))}
              </div>
            </section>
          )}

          {confirmed.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
                All Calls
              </h2>
              <div className="space-y-3">
                {confirmed.map((c) => (
                  <CallCard key={c.id} call={c} allTasks={tasks} onConfirm={handleConfirm} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
