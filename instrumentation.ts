export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;

  const appUrl = process.env.APP_URL || "http://localhost:3001";
  const syncIntervalMs = 30 * 60 * 1000;

  const runSync = async () => {
    try {
      const res = await fetch(`${appUrl}/api/sync`, { method: "POST" });
      const data = await res.json();
      console.log(`[auto-sync] ${new Date().toISOString()} — threads: ${data.threadsFetched ?? 0}, tasks: ${data.tasksExtracted ?? 0}`);
    } catch (e) {
      console.error("[auto-sync] failed:", e);
    }
  };

  const runBriefing = async () => {
    try {
      const res = await fetch(`${appUrl}/api/briefing`);
      const data = await res.json();
      console.log(`[briefing] generated at ${new Date().toISOString()}`);

      // Send to Slack DM if token is available
      if (data.briefing) {
        const { sendSlackDM } = await import("./lib/slack");
        const sent = await sendSlackDM(`*📋 Morning Briefing — ${new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Kolkata" })}*\n\n${data.briefing}`);
        if (sent) console.log("[briefing] sent via Slack DM");
        else console.log("[briefing] Slack not connected, briefing logged only:\n", data.briefing);
      }
    } catch (e) {
      console.error("[briefing] failed:", e);
    }
  };

  // Calculate ms until next 8:00 AM IST (UTC+5:30 = UTC 02:30)
  function msUntilNext8amIST(): number {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(2, 30, 0, 0); // 8:00 AM IST
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  // Auto-sync: wait 2 min after startup, then every 30 min
  setTimeout(() => {
    runSync();
    setInterval(runSync, syncIntervalMs);
  }, 2 * 60 * 1000);

  // Morning briefing: run at next 8am IST, then every 24h
  setTimeout(() => {
    runBriefing();
    setInterval(runBriefing, 24 * 60 * 60 * 1000);
  }, msUntilNext8amIST());

  console.log(`[auto-sync] scheduled — every 30 minutes`);
  const hoursUntilBriefing = (msUntilNext8amIST() / 3600000).toFixed(1);
  console.log(`[briefing] scheduled — next run in ${hoursUntilBriefing}h (8:00 AM IST)`);
}
