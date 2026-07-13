"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Status {
  google: boolean;
  slack: boolean;
  granola: boolean;
  anthropic: boolean;
  lastSync: string | null;
  taskCount: number;
  callCount: number;
}

function SettingsContent() {
  const [status, setStatus] = useState<Status | null>(null);
  const searchParams = useSearchParams();
  const connected = searchParams.get("connected");
  const [slackToken, setSlackToken] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackMsg, setSlackMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exclusions, setExclusions] = useState<Array<{id: string; pattern: string; intent: string; createdAt: string}>>([]);
  const [newRule, setNewRule] = useState("");
  const [syncLogs, setSyncLogs] = useState<Array<{id: string; source: string; status: string; message: string | null; syncedAt: string}>>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  async function saveSlackToken() {
    setSlackSaving(true);
    setSlackMsg(null);
    try {
      const res = await fetch("/api/auth/slack/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: slackToken.trim() }),
      });
      if (res.ok) {
        setSlackMsg({ ok: true, text: "Token saved!" });
        setSlackToken("");
        fetchStatus();
      } else {
        const data = await res.json();
        setSlackMsg({ ok: false, text: data.error || "Failed to save token" });
      }
    } catch {
      setSlackMsg({ ok: false, text: "Network error" });
    } finally {
      setSlackSaving(false);
    }
  }

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/status");
    setStatus(await res.json());
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    fetch("/api/exclusions").then(r => r.json()).then(setExclusions).catch(() => {});
    fetch("/api/sync-logs").then(r => r.json()).then(setSyncLogs).catch(() => {});
  }, []);

  const addRule = async () => {
    if (!newRule.trim()) return;
    const res = await fetch("/api/exclusions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: newRule.trim(), intent: "manual", keywords: newRule.trim().toLowerCase().split(" ") }),
    });
    const created = await res.json();
    setExclusions(prev => [created, ...prev]);
    setNewRule("");
  };

  const deleteRule = async (id: string) => {
    await fetch("/api/exclusions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setExclusions(prev => prev.filter(r => r.id !== id));
  };

  const ConnectRow = ({
    label,
    icon,
    connected,
    connectHref,
    description,
  }: {
    label: string;
    icon: string;
    connected: boolean;
    connectHref?: string;
    description: string;
  }) => (
    <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="text-xs text-zinc-500">{description}</p>
        </div>
      </div>

      {connected ? (
        <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          Connected
        </span>
      ) : connectHref ? (
        <a
          href={connectHref}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
        >
          Connect
        </a>
      ) : (
        <span className="text-xs text-zinc-600">Auto-detected</span>
      )}
    </div>
  );

  const missingEnv = [];
  if (!process.env.NEXT_PUBLIC_HAS_GOOGLE) missingEnv.push("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET");
  if (!process.env.NEXT_PUBLIC_HAS_SLACK) missingEnv.push("SLACK_CLIENT_ID, SLACK_CLIENT_SECRET");

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-zinc-500 text-sm mt-1">Connect your accounts — authenticate once, stays saved</p>
      </div>

      {connected && (
        <div className="mb-6 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
          ✓ {connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully
        </div>
      )}

      <div className="space-y-3 mb-8">
        <ConnectRow
          label="Google (Gmail, Calendar, Drive)"
          icon="🔵"
          connected={status?.google ?? false}
          connectHref="/api/auth/google"
          description="Pulls emails, calendar events, Docs & Sheets"
        />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💜</span>
              <div>
                <p className="text-sm font-medium text-white">Slack</p>
                <p className="text-xs text-zinc-500">Reads messages and mentions from your channels</p>
              </div>
            </div>
            {status?.slack ? (
              <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                Connected
              </span>
            ) : (
              <span className="text-xs text-zinc-500">Not connected</span>
            )}
          </div>
          <div className="px-4 pb-4 border-t border-zinc-800 pt-3">
            <p className="text-xs text-zinc-500 mb-2">Paste your Slack token (<code className="text-indigo-400">xoxc-</code> or <code className="text-indigo-400">xoxp-</code>)</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={slackToken}
                onChange={(e) => setSlackToken(e.target.value)}
                placeholder="xoxc-..."
                className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={saveSlackToken}
                disabled={slackSaving || !slackToken.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium transition-colors"
              >
                {slackSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {slackMsg && (
              <p className={`text-xs mt-2 ${slackMsg.ok ? "text-green-400" : "text-red-400"}`}>{slackMsg.text}</p>
            )}
          </div>
        </div>
        <ConnectRow
          label="Granola"
          icon="🟢"
          connected={status?.granola ?? false}
          description="Reads meeting notes from your local Granola app"
        />
      </div>

      {status && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900 text-center">
            <p className="text-2xl font-bold text-white">{status.taskCount}</p>
            <p className="text-xs text-zinc-500 mt-1">Open Tasks</p>
          </div>
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900 text-center">
            <p className="text-2xl font-bold text-white">{status.callCount}</p>
            <p className="text-xs text-zinc-500 mt-1">Calls Tracked</p>
          </div>
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900 text-center">
            <p className="text-2xl font-bold text-white">{status.lastSync ? "✓" : "—"}</p>
            <p className="text-xs text-zinc-500 mt-1">Last Synced</p>
          </div>
        </div>
      )}

      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
        <h2 className="text-sm font-semibold text-white mb-3">Setup checklist</h2>
        <div className="space-y-2 text-xs text-zinc-400">
          <p>
            1.{" "}
            <span className={status?.google ? "line-through text-zinc-600" : ""}>
              Add <code className="text-indigo-400">GOOGLE_CLIENT_ID</code> &{" "}
              <code className="text-indigo-400">GOOGLE_CLIENT_SECRET</code> to <code>.env.local</code>
            </span>
          </p>
          <p>
            2.{" "}
            <span className={status?.slack ? "line-through text-zinc-600" : ""}>
              Add <code className="text-indigo-400">SLACK_CLIENT_ID</code> &{" "}
              <code className="text-indigo-400">SLACK_CLIENT_SECRET</code> to <code>.env.local</code>
            </span>
          </p>
          <p>
            3.{" "}
            <span className={status?.anthropic ? "line-through text-zinc-600" : ""}>
              Add <code className="text-indigo-400">ANTHROPIC_API_KEY</code> to <code>.env.local</code>
            </span>
          </p>
          <p>
            4.{" "}
            <span className={status?.google ? "line-through text-zinc-600" : ""}>
              Connect Google above → opens OAuth flow
            </span>
          </p>
          <p>
            5.{" "}
            <span className={status?.slack ? "line-through text-zinc-600" : ""}>
              Connect Slack above
            </span>
          </p>
          <p>
            6. Hit <strong className="text-white">Sync now</strong> on the Today page
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        <button
          onClick={() => setLogsOpen(v => !v)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/50 transition-colors"
        >
          <div>
            <h2 className="text-sm font-semibold text-white">Sync Logs <span className="text-zinc-500 font-normal">({syncLogs.length})</span></h2>
            <p className="text-xs text-zinc-500 mt-0.5">What happened during the last sync</p>
          </div>
          <span className="text-zinc-500 text-xs">{logsOpen ? "▲ Hide" : "▼ Show"}</span>
        </button>
        {logsOpen && (
          <div className="border-t border-zinc-800 p-4">
            {syncLogs.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">No sync logs yet. Hit Sync now to start.</p>
            ) : (
              <div className="space-y-1 font-mono">
                {syncLogs.map(log => {
                  const isError = log.status === "error";
                  const time = new Date(log.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return (
                    <div key={log.id} className={`flex items-start gap-2 text-xs py-1 border-b border-zinc-800/50 last:border-0 ${isError ? "text-red-400" : "text-zinc-400"}`}>
                      <span className="shrink-0 text-zinc-600">{time}</span>
                      <span className={`shrink-0 w-3 ${isError ? "text-red-400" : "text-green-400"}`}>{isError ? "✕" : "✓"}</span>
                      <span className="shrink-0 text-zinc-300 w-28">{log.source}</span>
                      <span className={isError ? "text-red-400" : "text-zinc-500"}>{log.message || (isError ? "failed" : "ok")}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => fetch("/api/sync-logs", { method: "DELETE" }).then(() => setSyncLogs([]))} className="mt-3 text-xs text-zinc-600 hover:text-red-400 transition-colors">Clear logs</button>
          </div>
        )}
      </div>

      <div className="mt-8 p-4 rounded-xl border border-zinc-800 bg-zinc-900">
        <h2 className="text-sm font-semibold text-white mb-1">Exclusion Rules <span className="text-zinc-500 font-normal">({exclusions.length})</span></h2>
        <p className="text-xs text-zinc-500 mb-4">When you delete a task, Claude learns not to surface similar ones. You can also add rules manually.</p>
        <div className="flex gap-2 mb-4">
          <input
            value={newRule}
            onChange={e => setNewRule(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addRule()}
            placeholder="e.g. automated FTP monitoring alerts"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
          />
          <button onClick={addRule} disabled={!newRule.trim()} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs rounded-lg">Add Rule</button>
        </div>
        {exclusions.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-4">No rules yet. Delete tasks you don&apos;t want to see and Claude will learn automatically.</p>
        ) : (
          <div className="space-y-2">
            {exclusions.map(rule => (
              <div key={rule.id} className="flex items-start justify-between gap-3 p-3 bg-zinc-800/50 rounded-lg">
                <div>
                  <p className="text-xs text-white">{rule.pattern}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{rule.intent}</p>
                </div>
                <button onClick={() => deleteRule(rule.id)} className="text-zinc-600 hover:text-red-400 text-xs shrink-0">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-500">Loading...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
