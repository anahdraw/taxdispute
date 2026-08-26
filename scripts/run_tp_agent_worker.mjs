const endpoint = String(process.env.TP_AGENT_WORKER_URL || "http://127.0.0.1:3000/api/internal/tp-agent-worker").trim();
const secret = String(process.env.CRON_SECRET || "").trim();
const limit = Math.max(1, Math.min(100, Number(process.env.TP_AGENT_WORKER_MAX_RUNS || 20)));

if (!secret) {
  throw new Error("CRON_SECRET is required to run the TP agent worker.");
}

for (let index = 0; index < limit; index += 1) {
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${secret}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `TP agent worker failed (${response.status}).`);
  if (!payload.processed) {
    process.stdout.write("TP agent queue is empty.\n");
    break;
  }
  process.stdout.write(`${payload.run?.stage || "unknown"}: ${payload.run?.status || "processed"}\n`);
}
