"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { WorkspaceClient, WorkspaceMatter, WorkspaceMembership, WorkspaceTenant } from "@/lib/workspace";
import {
  readActiveWorkspaceContext,
  writeActiveWorkspaceContext,
  type ActiveWorkspaceContext
} from "@/lib/workspace-client-context";
import { ResearchWorkspaceClient } from "./research-workspace-client";

type TenantRecord = { tenant: WorkspaceTenant; membership: WorkspaceMembership };
type PrivateFile = { id: string; filename: string; contentType: string; size: number; createdAt: string };

function qs(values: Record<string, string>) {
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => Boolean(value)));
  return `?${params.toString()}`;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function WorkspaceDashboard() {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [clients, setClients] = useState<WorkspaceClient[]>([]);
  const [matters, setMatters] = useState<WorkspaceMatter[]>([]);
  const [files, setFiles] = useState<PrivateFile[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [matterId, setMatterId] = useState("");
  const [clientName, setClientName] = useState("");
  const [matterName, setMatterName] = useState("");
  const [status, setStatus] = useState("Menyiapkan workspace lokal...");
  const [busy, setBusy] = useState(false);
  const persistedContext = useRef<ActiveWorkspaceContext | null>(null);
  const [scopeReady, setScopeReady] = useState(false);

  useEffect(() => {
    persistedContext.current = readActiveWorkspaceContext();
    void fetch("/api/workspaces", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Workspace tidak dapat dimuat.");
      const records = payload.records as TenantRecord[];
      setTenants(records);
      const preferredTenant = persistedContext.current?.tenantId;
      setTenantId(records.some(({ tenant }) => tenant.id === preferredTenant) ? preferredTenant || "" : records[0]?.tenant.id || "");
      setStatus(`Penyimpanan ${payload.store === "local" ? "lokal privat" : "database privat"} aktif.`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Workspace tidak dapat dimuat."));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void fetch(`/api/clients${qs({ tenantId })}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setClients(payload.records || []);
      setClientId((current) => {
        if (payload.records?.some((item: WorkspaceClient) => item.id === current)) return current;
        const preferredClient = persistedContext.current?.tenantId === tenantId ? persistedContext.current.clientId : "";
        return payload.records?.some((item: WorkspaceClient) => item.id === preferredClient) ? preferredClient || "" : payload.records?.[0]?.id || "";
      });
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Client tidak dapat dimuat."));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !clientId) { setMatters([]); setMatterId(""); setScopeReady(Boolean(tenantId)); return; }
    void fetch(`/api/matters${qs({ tenantId, clientId })}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setMatters(payload.records || []);
      setMatterId((current) => {
        if (payload.records?.some((item: WorkspaceMatter) => item.id === current)) return current;
        const preferredMatter = persistedContext.current?.clientId === clientId ? persistedContext.current.matterId : "";
        return payload.records?.some((item: WorkspaceMatter) => item.id === preferredMatter) ? preferredMatter || "" : payload.records?.[0]?.id || "";
      });
      setScopeReady(true);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Matter tidak dapat dimuat."));
  }, [tenantId, clientId]);

  useEffect(() => {
    if (!scopeReady || !tenantId) return;
    writeActiveWorkspaceContext({
      tenantId,
      ...(clientId ? { clientId } : {}),
      ...(clientId && matterId ? { matterId } : {})
    });
  }, [scopeReady, tenantId, clientId, matterId]);

  async function loadFiles() {
    if (!tenantId || !clientId || !matterId) { setFiles([]); return; }
    const response = await fetch(`/api/private-files${qs({ tenantId, clientId, matterId })}`, { cache: "no-store" });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
    setFiles(payload.records || []);
  }

  useEffect(() => { void loadFiles().catch((error) => setStatus(error instanceof Error ? error.message : "Dokumen tidak dapat dimuat.")); }, [tenantId, clientId, matterId]);

  async function createClient(event: FormEvent) {
    event.preventDefault(); if (!clientName.trim() || !tenantId) return; setBusy(true);
    try {
      const response = await fetch(`/api/clients${qs({ tenantId })}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clientName }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setClients((current) => [payload.record, ...current]); setClientId(payload.record.id); setClientName(""); setStatus("Client dibuat.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Client tidak dapat dibuat."); } finally { setBusy(false); }
  }

  async function createMatter(event: FormEvent) {
    event.preventDefault(); if (!matterName.trim() || !tenantId || !clientId) return; setBusy(true);
    try {
      const response = await fetch(`/api/matters${qs({ tenantId, clientId })}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, name: matterName }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      setMatters((current) => [payload.record, ...current]); setMatterId(payload.record.id); setMatterName(""); setStatus("Matter dibuat.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Matter tidak dapat dibuat."); } finally { setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!tenantId || !clientId || !matterId) return;
    const input = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return; setBusy(true);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch(`/api/private-files${qs({ tenantId, clientId, matterId })}`, { method: "POST", body: form });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      input.value = ""; await loadFiles(); setStatus("Dokumen disimpan di private storage matter.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Upload gagal."); } finally { setBusy(false); }
  }

  async function removeFile(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/private-files/${encodeURIComponent(id)}${qs({ tenantId, clientId, matterId })}`, { method: "DELETE" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      await loadFiles(); setStatus("Dokumen dihapus.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Dokumen tidak dapat dihapus."); } finally { setBusy(false); }
  }

  const context = { tenantId, clientId: clientId || undefined, matterId: matterId || undefined };
  return (
    <>
      <section className="workspace-context-panel">
        <label>Tenant<select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map(({ tenant }) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
        <label>Client<select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Pilih client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label>Matter<select value={matterId} onChange={(event) => setMatterId(event.target.value)}><option value="">Pilih matter</option>{matters.map((matter) => <option key={matter.id} value={matter.id}>{matter.name}</option>)}</select></label>
        <p role="status">{status}</p>
        <form onSubmit={createClient}><input maxLength={180} onChange={(event) => setClientName(event.target.value)} placeholder="Nama client baru" value={clientName} /><button disabled={busy || !clientName.trim()} type="submit">Tambah client</button></form>
        <form onSubmit={createMatter}><input maxLength={180} onChange={(event) => setMatterName(event.target.value)} placeholder="Nama matter baru" value={matterName} /><button disabled={busy || !clientId || !matterName.trim()} type="submit">Tambah matter</button></form>
      </section>

      <section className="workspace-private-files">
        <div><span className="case-detail-kicker">Private storage</span><h2>Dokumen matter</h2></div>
        <form onSubmit={upload}><input accept=".pdf,.doc,.docx,.txt,.csv,.xlsx" disabled={!matterId || busy} name="file" type="file" /><button className="primary-button small-button" disabled={!matterId || busy} type="submit">Upload privat</button></form>
        <div className="private-file-list">
          {files.map((file) => <article key={file.id}><div><b>{file.filename}</b><span>{bytes(file.size)} · {new Date(file.createdAt).toLocaleString("id-ID")}</span></div><div><a href={`/api/private-files/${encodeURIComponent(file.id)}${qs({ tenantId, clientId, matterId })}`}>Unduh</a><button disabled={busy} onClick={() => void removeFile(file.id)} type="button">Hapus</button></div></article>)}
          {!files.length && <p>{matterId ? "Belum ada dokumen privat pada matter ini." : "Pilih atau buat matter untuk mengunggah dokumen."}</p>}
        </div>
      </section>

      {tenantId && <ResearchWorkspaceClient key={`${tenantId}:${clientId}:${matterId}`} context={context} />}
    </>
  );
}
