"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ResearchWorkspaceEntity, ResearchWorkspaceSnapshot } from "@/lib/research-workspace";

const EMPTY: ResearchWorkspaceSnapshot = {
  schemaVersion: 1,
  scope: { tenantId: "", userId: "" },
  folders: [],
  savedItems: [],
  highlights: [],
  history: []
};

type WorkspaceContext = {
  tenantId?: string;
  clientId?: string;
  matterId?: string;
};

function queryString(context: WorkspaceContext) {
  const params = new URLSearchParams();
  if (context.tenantId) params.set("tenantId", context.tenantId);
  if (context.clientId) params.set("clientId", context.clientId);
  if (context.matterId) params.set("matterId", context.matterId);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function shortDate(value: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ResearchWorkspaceClient({ context = {} }: { context?: WorkspaceContext }) {
  const [data, setData] = useState<ResearchWorkspaceSnapshot>(EMPTY);
  const [tab, setTab] = useState<"saved" | "highlights" | "history">("saved");
  const [folderId, setFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureUrl, setCaptureUrl] = useState("");
  const [captureQuote, setCaptureQuote] = useState("");
  const [status, setStatus] = useState("Memuat workspace riset...");
  const [busy, setBusy] = useState(false);

  const endpoint = `/api/research-workspace${queryString(context)}`;

  async function reload() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Workspace tidak dapat dimuat.");
    setData(payload as ResearchWorkspaceSnapshot);
    setStatus("");
  }

  useEffect(() => {
    void reload().catch((error) => setStatus(error instanceof Error ? error.message : "Workspace tidak dapat dimuat."));
    // endpoint fully represents the selected context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const folderNames = useMemo(() => new Map(data.folders.map((folder) => [folder.id, folder.name])), [data.folders]);
  const savedItems = folderId ? data.savedItems.filter((item) => item.folderId === folderId) : data.savedItems;
  const highlights = folderId ? data.highlights.filter((item) => item.folderId === folderId) : data.highlights;

  async function mutate(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Perubahan tidak dapat disimpan.");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    try {
      await mutate("POST", { entity: "folder", name });
      setFolderName("");
      setStatus("Folder dibuat.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Folder tidak dapat dibuat.");
    }
  }

  async function capture(entity: "saved-item" | "highlight") {
    if (!captureTitle.trim() || (entity === "highlight" && !captureQuote.trim())) return;
    try {
      await mutate("POST", {
        entity,
        resourceType: "external",
        resourceId: captureUrl.trim() || `manual-${Date.now()}`,
        title: captureTitle,
        url: captureUrl,
        quote: captureQuote,
        folderId: folderId || undefined
      });
      setCaptureTitle(""); setCaptureUrl(""); setCaptureQuote(""); setTab(entity === "saved-item" ? "saved" : "highlights");
      setStatus(entity === "saved-item" ? "Referensi disimpan." : "Highlight disimpan.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Item tidak dapat disimpan.");
    }
  }

  async function remove(entity: ResearchWorkspaceEntity, id: string) {
    try {
      await mutate("DELETE", { entity, id });
      setStatus("Item dihapus.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Item tidak dapat dihapus.");
    }
  }

  async function move(entity: "saved-item" | "highlight", id: string, nextFolderId: string) {
    try {
      await mutate("PATCH", { entity, id, folderId: nextFolderId || null });
      setStatus("Folder diperbarui.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Folder tidak dapat diperbarui.");
    }
  }

  return (
    <div className="research-workspace-layout">
      <aside className="research-folders" aria-label="Folder riset">
        <div>
          <span className="case-detail-kicker">Koleksi pribadi</span>
          <h2>Folder</h2>
        </div>
        <button className={!folderId ? "active" : ""} onClick={() => setFolderId("")} type="button">
          Semua item <b>{data.savedItems.length + data.highlights.length}</b>
        </button>
        {data.folders.map((folder) => (
          <button className={folderId === folder.id ? "active" : ""} key={folder.id} onClick={() => setFolderId(folder.id)} type="button">
            <i style={{ backgroundColor: folder.color }} /> {folder.name}
            <b>{data.savedItems.filter((item) => item.folderId === folder.id).length + data.highlights.filter((item) => item.folderId === folder.id).length}</b>
          </button>
        ))}
        <form onSubmit={createFolder}>
          <input aria-label="Nama folder baru" maxLength={180} onChange={(event) => setFolderName(event.target.value)} placeholder="Folder baru" value={folderName} />
          <button className="primary-button small-button" disabled={busy || !folderName.trim()} type="submit">Tambah</button>
        </form>
      </aside>

      <section className="research-library">
        <div className="research-capture">
          <input aria-label="Judul referensi" maxLength={500} onChange={(event) => setCaptureTitle(event.target.value)} placeholder="Judul putusan, aturan, atau referensi" value={captureTitle} />
          <input aria-label="Tautan referensi" maxLength={2048} onChange={(event) => setCaptureUrl(event.target.value)} placeholder="Tautan internal atau https://... (opsional)" value={captureUrl} />
          <textarea aria-label="Kutipan untuk highlight" maxLength={20000} onChange={(event) => setCaptureQuote(event.target.value)} placeholder="Tempel kutipan untuk dibuat highlight (opsional untuk simpan referensi)" value={captureQuote} />
          <div>
            <button disabled={busy || !captureTitle.trim()} onClick={() => void capture("saved-item")} type="button">Simpan referensi</button>
            <button disabled={busy || !captureTitle.trim() || !captureQuote.trim()} onClick={() => void capture("highlight")} type="button">Simpan highlight</button>
          </div>
        </div>
        <div className="research-tabs" role="tablist" aria-label="Jenis koleksi riset">
          <button aria-selected={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")} role="tab" type="button">Tersimpan ({savedItems.length})</button>
          <button aria-selected={tab === "highlights"} className={tab === "highlights" ? "active" : ""} onClick={() => setTab("highlights")} role="tab" type="button">Highlight ({highlights.length})</button>
          <button aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")} role="tab" type="button">Riwayat ({data.history.length})</button>
        </div>

        {status && <p className="research-status" role="status">{status}</p>}

        <div className="research-item-list">
          {tab === "saved" && savedItems.map((item) => (
            <article className="research-item" key={item.id}>
              <div>
                <span>{item.resourceType} · {shortDate(item.updatedAt)}</span>
                <h3>{item.url ? <a href={item.url}>{item.title}</a> : item.title}</h3>
                {item.excerpt && <p>{item.excerpt}</p>}
                {item.note && <small>Catatan: {item.note}</small>}
              </div>
              <div className="research-item-actions">
                <select aria-label="Pindahkan ke folder" onChange={(event) => void move("saved-item", item.id, event.target.value)} value={item.folderId || ""}>
                  <option value="">Tanpa folder</option>
                  {data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <button disabled={busy} onClick={() => void remove("saved-item", item.id)} type="button">Hapus</button>
              </div>
            </article>
          ))}

          {tab === "highlights" && highlights.map((item) => (
            <article className="research-item research-highlight" key={item.id} style={{ borderLeftColor: item.color }}>
              <div>
                <span>{item.resourceType}{item.anchor.page !== undefined ? ` · Halaman ${item.anchor.page}` : ""} · {shortDate(item.updatedAt)}</span>
                <h3>{item.url ? <a href={item.url}>{item.title}</a> : item.title}</h3>
                <blockquote>{item.quote}</blockquote>
                {item.note && <small>Catatan: {item.note}</small>}
              </div>
              <div className="research-item-actions">
                <select aria-label="Pindahkan ke folder" onChange={(event) => void move("highlight", item.id, event.target.value)} value={item.folderId || ""}>
                  <option value="">Tanpa folder</option>
                  {data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <button disabled={busy} onClick={() => void remove("highlight", item.id)} type="button">Hapus</button>
              </div>
            </article>
          ))}

          {tab === "history" && data.history.map((item) => (
            <article className="research-item compact" key={item.id}>
              <div>
                <span>{item.action} · {item.resourceType} · {shortDate(item.createdAt)}</span>
                <h3>{item.url ? <a href={item.url}>{item.title}</a> : item.title}</h3>
                {item.query && <p>{item.query}</p>}
              </div>
              <button disabled={busy} onClick={() => void remove("history", item.id)} type="button">Hapus</button>
            </article>
          ))}

          {((tab === "saved" && savedItems.length === 0) || (tab === "highlights" && highlights.length === 0) || (tab === "history" && data.history.length === 0)) && !status && (
            <div className="research-empty"><b>Belum ada data.</b><span>Item yang disimpan, highlight, dan aktivitas riset akan muncul di sini.</span></div>
          )}
        </div>
        <p className="research-scope-note">Data hanya ditampilkan untuk user, tenant{context.clientId ? ", client" : ""}{context.matterId ? ", dan matter" : ""} yang sedang aktif.</p>
      </section>
    </div>
  );
}
