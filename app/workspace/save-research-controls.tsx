"use client";

import { useEffect, useState } from "react";
import type { ResearchResourceType } from "@/lib/research-workspace";
import { readActiveWorkspaceContext } from "@/lib/workspace-client-context";

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
  /** Records a scoped view event once when rendered on a source detail page. */
  recordView?: boolean;
};

/** Reusable controls for decision/regulation/reference screens. Scope is always revalidated by the API. */
export function SaveResearchControls(props: SaveResearchControlsProps) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function endpoint() {
    const active = readActiveWorkspaceContext();
    const params = new URLSearchParams();
    const tenantId = props.tenantId || active?.tenantId;
    const clientId = props.clientId || active?.clientId;
    const matterId = props.matterId || active?.matterId;
    if (tenantId) params.set("tenantId", tenantId);
    if (clientId) params.set("clientId", clientId);
    if (matterId) params.set("matterId", matterId);
    return `/api/research-workspace${params.size ? `?${params}` : ""}`;
  }

  useEffect(() => {
    if (!props.recordView) return;
    void fetch(endpoint(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "history", action: "view", resourceType: props.resourceType, resourceId: props.resourceId, title: props.title, url: props.url || window.location.pathname, responseExcerpt: props.excerpt || "" })
    }).catch(() => undefined);
    // Source identity is stable for the mounted detail page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resourceId, props.recordView]);

  async function save(entity: "saved-item" | "highlight") {
    setBusy(true);
    try {
      const response = await fetch(endpoint(), {
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
