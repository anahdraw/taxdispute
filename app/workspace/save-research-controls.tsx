"use client";

import { useState } from "react";
import type { ResearchResourceType } from "@/lib/research-workspace";

type SaveResearchControlsProps = {
  resourceType: ResearchResourceType;
  resourceId: string;
  title: string;
  url?: string;
  excerpt?: string;
  quote?: string;
  tenantId?: string;
  clientId?: string;
  matterId?: string;
};

/** Reusable controls for decision/regulation/reference screens. Scope is always revalidated by the API. */
export function SaveResearchControls(props: SaveResearchControlsProps) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(entity: "saved-item" | "highlight") {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (props.tenantId) params.set("tenantId", props.tenantId);
      if (props.clientId) params.set("clientId", props.clientId);
      if (props.matterId) params.set("matterId", props.matterId);
      const response = await fetch(`/api/research-workspace${params.size ? `?${params}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          resourceType: props.resourceType,
          resourceId: props.resourceId,
          title: props.title,
          url: props.url || window.location.pathname,
          excerpt: props.excerpt || "",
          quote: props.quote || props.excerpt || ""
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Item tidak dapat disimpan.");
      setStatus(entity === "saved-item" ? "Tersimpan" : "Highlight tersimpan");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="save-research-controls">
      <button disabled={busy} onClick={() => void save("saved-item")} type="button">Simpan</button>
      {(props.quote || props.excerpt) && <button disabled={busy} onClick={() => void save("highlight")} type="button">Highlight</button>}
      {status && <small role="status">{status}</small>}
    </div>
  );
}
