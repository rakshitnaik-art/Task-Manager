export async function register() {
  // Only run in Node.js runtime (not Edge) and only in production
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;

  const appUrl = process.env.APP_URL || "http://localhost:3001";
  const intervalMs = 30 * 60 * 1000; // 30 minutes

  const runSync = async () => {
    try {
      const res = await fetch(`${appUrl}/api/sync`, { method: "POST" });
      const data = await res.json();
      console.log(`[auto-sync] ${new Date().toISOString()} — threads: ${data.threadsFetched ?? 0}, tasks: ${data.tasksExtracted ?? 0}`);
    } catch (e) {
      console.error("[auto-sync] failed:", e);
    }
  };

  // Wait 2 minutes after startup before first auto-sync (let the server settle)
  setTimeout(() => {
    runSync();
    setInterval(runSync, intervalMs);
  }, 2 * 60 * 1000);

  console.log("[auto-sync] scheduled — runs every 30 minutes");
}
