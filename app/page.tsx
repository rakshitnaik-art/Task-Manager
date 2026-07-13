"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import TaskCard from "@/components/TaskCard";
import TaskDrawer from "@/components/TaskDrawer";
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
}

interface Stats { doneThisWeek: number; overdue: number; }
type View = "today" | "week";

function groupByLabel(tasks: Task[]): Array<{ label: string | null; tasks: Task[] }> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.projectLabel || "__none__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const groups: Array<{ label: string | null; tasks: Task[] }> = [];
  for (const [key, tasks] of map) {
    groups.push({ label: key === "__none__" ? null : key, tasks });
  }
  return groups.sort((a, b) => {
    if (a.label === null) return 1;
    if (b.label === null) return -1;
    return a.label.localeCompare(b.label);
  });
}

export default function TodayPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [view, setView] = useState<View>("today");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?statsOnly=true");
      setStats(await res.json());
    } catch {}
  }, []);

  const fetchTasks = useCallback(async (v: View) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?view=${v}`);
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setLastSync(data.lastSync ?? null);
    } catch {}
  }, []);

  const reprioritize = useCallback(async () => {
    try { await fetch("/api/reprioritize", { method: "POST" }); } catch {}
  }, []);

  const groupTasks = useCallback(async () => {
    try { await fetch("/api/group-tasks", { method: "POST" }); } catch {}
  }, []);

  useEffect(() => {
    fetchTasks(view);
    fetchStatus();
    fetchStats();
    reprioritize();
    groupTasks().then(() => fetchTasks(view));
  }, [view, fetchTasks, fetchStatus, fetchStats, reprioritize, groupTasks]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST" });
    await Promise.all([reprioritize(), groupTasks()]);
    await Promise.all([fetchTasks(view), fetchStatus(), fetchStats()]);
    setSyncing(false);
  };

  const handleDone = async (id: string) => {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    setTasks(prev => prev.filter(t => t.id !== id));
    fetchStats();
  };

  const handleDelete = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    fetchStats();
  };

  const handleUpdate = (updated: Task) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const handleSnooze = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleStatusChange = (id: string, status: string, blockedReason?: string) => {
    if (status === "closed" || status === "done") {
      setTasks(prev => prev.filter(t => t.id !== id));
      fetchStats();
    } else {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status, blockedReason: blockedReason ?? t.blockedReason } : t));
    }
  };

  // Chat bar — calls the conversational AI assistant
  const handleChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    setChatReply(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: msg }] }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setChatInput("");
      setChatReply(data.reply || "Done");
      // Refresh tasks in case the assistant created/updated any
      await fetchTasks(view);
      fetchStats();
    } catch {
      setChatError("Could not process — try again");
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleChat();
  };

  const now = new Date();
  const searchLower = search.toLowerCase();

  let filtered = tasks;
  if (overdueOnly) filtered = filtered.filter(t => t.deadline && new Date(t.deadline) < now);
  if (searchLower) filtered = filtered.filter(t =>
    t.title.toLowerCase().includes(searchLower) ||
    (t.description || "").toLowerCase().includes(searchLower) ||
    (t.projectLabel || "").toLowerCase().includes(searchLower)
  );

  const groups = groupByLabel(filtered);
  const todayLabel = view === "today" ? "today" : "this week";

  return (
    <>
    {openTaskId && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    <div className="flex flex-col min-h-screen">
      <div className="flex-1 p-8 max-w-3xl pb-56">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Good morning, Rakshit</h1>
            <p className="text-zinc-500 text-sm mt-1">
              {format(new Date(), "EEEE, MMMM d")} · {filtered.length === 0 ? `No tasks ${todayLabel}` : `${filtered.length} task${filtered.length !== 1 ? "s" : ""} need your attention`}
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
            {syncing ? <><span className="animate-spin">⟳</span> Syncing...</> : <>⟳ Sync now</>}
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-3 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400">
              <span>✓</span> <span><strong>{stats.doneThisWeek}</strong> done this week</span>
            </div>
            {stats.overdue > 0 && (
              <button
                onClick={() => setOverdueOnly(v => !v)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${overdueOnly ? "bg-red-500/30 border border-red-500/60 text-red-300" : "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"}`}
              >
                <span>⚠</span> <span><strong>{stats.overdue}</strong> overdue{overdueOnly ? " — showing only" : ""}</span>
              </button>
            )}
          </div>
        )}

        {lastSync && <p className="text-xs text-zinc-600 mb-3">Last synced {format(new Date(lastSync), "h:mm a")}</p>}

        {/* Search bar */}
        <div className="relative mb-5">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 bg-zinc-900 rounded-lg w-fit border border-zinc-800">
          {(["today", "week"] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === v ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"}`}>
              {v === "today" ? "Today" : "This Week"}
            </button>
          ))}
        </div>

        {/* Task list */}
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-zinc-800/50 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-zinc-600">
            <p className="text-4xl mb-3">{search ? "🔍" : "🎉"}</p>
            <p className="text-lg font-medium text-zinc-400">{search ? `No tasks matching "${search}"` : `All clear for ${todayLabel}`}</p>
            <p className="text-sm mt-1">{search ? "Try a different search" : "Hit sync to pull in the latest, or drop a task below"}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(group => (
              <section key={group.label ?? "__none__"}>
                <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  {group.label ? (
                    <span className="px-2 py-0.5 bg-zinc-800 rounded-md">{group.label}</span>
                  ) : (
                    <span className="text-zinc-600">Other</span>
                  )}
                  <span className="text-zinc-700 font-normal normal-case tracking-normal">{group.tasks.length}</span>
                </h2>
                <div className="space-y-2">
                  {group.tasks.map(t => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onDone={handleDone}
                      onDelete={handleDelete}
                      onUpdate={handleUpdate}
                      onSnooze={handleSnooze}
                      onStatusChange={handleStatusChange}
                      onOpen={setOpenTaskId}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Chat bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm p-4">
        <div className="max-w-3xl mx-auto">
          {/* Assistant reply */}
          {chatReply && (
            <div className="mb-2 px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-xs text-zinc-300 leading-relaxed">
              {chatReply}
              <button onClick={() => setChatReply(null)} className="ml-2 text-zinc-600 hover:text-zinc-400">✕</button>
            </div>
          )}
          {chatError && <p className="text-xs text-red-400 mb-1.5">{chatError}</p>}
          <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Ask anything or add a task… e.g. "what should I do first?" or "add task to call Ankit tomorrow"'
              rows={2}
              className="flex-1 bg-zinc-900 border border-zinc-700 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 resize-none focus:outline-none transition-colors"
            />
            <button
              onClick={handleChat}
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl text-sm font-medium text-white transition-colors shrink-0"
            >
              {chatLoading ? <span className="animate-spin inline-block">⟳</span> : "Ask"}
            </button>
          </div>
          <p className="text-xs text-zinc-700 mt-1.5">Cmd+Enter to send · <a href="/chat" className="hover:text-zinc-500 transition-colors">Open full chat →</a></p>
        </div>
      </div>
    </div>
    </>
  );
}
