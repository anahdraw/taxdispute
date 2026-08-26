"use client";

import { useState } from "react";
import { readActiveWorkspaceContext } from "@/lib/workspace-client-context";

export function WatchSourceControl({ resourceId, citation, name }: { resourceId: string; citation: string; name: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function watch() {
    setBusy(true);
    try {
      const context = readActiveWorkspaceContext();
      const params = new URLSearchParams();
      if (context?.tenantId) params.set("tenantId", context.tenantId);
      if (context?.clientId) params.set("clientId", context.clientId);
      if (context?.matterId) params.set("matterId", context.matterId);
      const response = await fetch(`/api/watchlist${params.size ? `?${params}` : ""}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Pantau ${citation}`, resourceId, citation, frequency: "daily" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Watchlist tidak dapat dibuat.");
      setStatus("Dipantau");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Gagal memantau"); } finally { setBusy(false); }
  }
  return <div className="watch-source-control"><button aria-label={`Pantau perubahan ${name}`} disabled={busy || status === "Dipantau"} onClick={() => void watch()} type="button">{busy ? "Menyimpan..." : status === "Dipantau" ? "✓ Dipantau" : "Pantau perubahan"}</button>{status && status !== "Dipantau" && <small role="status">{status}</small>}</div>;
}
