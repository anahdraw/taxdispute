"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExtractionResult } from "@/lib/extraction";
import type { StoredDecisionFile } from "@/lib/stored-decisions";

type DecisionDetailActionsProps = {
  document: StoredDecisionFile;
  backLabel: string;
  printLabel: string;
  canManage?: boolean;
};

function friendlyActionError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || "");
  if (/unexpected token|not valid json|an error occurred|non-json|timed out|timeout/i.test(message)) {
    return "Re-extraction could not finish for this document in the online serverless run. The existing extraction is still preserved. You can try again later, use Edit extraction to adjust this case, or re-upload a smaller/compressed PDF for a cleaner extraction.";
  }
  return message || "The action could not be completed.";
}

async function readActionResponse(response: Response): Promise<{ error?: string }> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ? { ...parsed, error: friendlyActionError(parsed.error) } : parsed;
  } catch {
    return {
      error: response.ok
        ? ""
        : friendlyActionError(text)
    };
  }
}

export function DecisionDetailActions({ document, backLabel, printLabel, canManage = false }: DecisionDetailActionsProps) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<"" | "extract" | "save" | "delete">("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [draftJson, setDraftJson] = useState(() => JSON.stringify(document.extraction || {}, null, 2));
  const canDownloadPdf = (document.downloadUrl || document.url).startsWith("https://");
  const actionDisabled = Boolean(busyAction);
  const editSummary = useMemo(() => {
    const extraction = document.extraction;
    if (!extraction) return "No extraction data yet.";
    return [extraction.putusanNumber, extraction.taxpayerName, extraction.taxType].filter(Boolean).join(" · ") || "Extraction JSON";
  }, [document.extraction]);

  async function reExtract() {
    if (!canDownloadPdf) {
      setError("Original PDF URL is not available.");
      return;
    }
    setBusyAction("extract");
    setStatus("");
    setError("");
    try {
      const response = await fetch("/api/decisions/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...document, language: "id" })
      });
      const data = await readActionResponse(response);
      if (!response.ok) throw new Error(data.error || "Re-extraction failed.");
      setStatus("Re-extraction completed. Page refreshed with the latest data.");
      router.refresh();
    } catch (caught) {
      setError(friendlyActionError(caught));
    } finally {
      setBusyAction("");
    }
  }

  async function saveEdit() {
    setBusyAction("save");
    setStatus("");
    setError("");
    try {
      const parsed = JSON.parse(draftJson) as ExtractionResult;
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...document,
          status: "extracted",
          extraction: parsed
        })
      });
      const data = await readActionResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not save extraction edits.");
      setIsEditing(false);
      setStatus("Extraction edits saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof SyntaxError ? "JSON is not valid. Please fix the extraction JSON first." : friendlyActionError(caught));
    } finally {
      setBusyAction("");
    }
  }

  async function deleteDocument() {
    if (!window.confirm("Delete this document from the database and Blob?")) return;
    setBusyAction("delete");
    setStatus("");
    setError("");
    try {
      const response = await fetch("/api/decisions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document)
      });
      const data = await readActionResponse(response);
      if (!response.ok) throw new Error(data.error || "Could not delete document.");
      router.push("/?page=database");
    } catch (caught) {
      setError(friendlyActionError(caught));
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="detail-action-menu">
      <a className="table-button" href="/?page=database">
        {backLabel}
      </a>
      <button className="table-button" onClick={() => window.print()}>
        {printLabel}
      </button>
      {canManage && (
        <>
          <button className="table-button" onClick={reExtract} disabled={actionDisabled || !canDownloadPdf}>
            {busyAction === "extract" ? "Re-extracting..." : "Re-extract"}
          </button>
          <button className="table-button" onClick={() => setIsEditing((current) => !current)} disabled={actionDisabled}>
            {isEditing ? "Close edit" : "Edit extraction"}
          </button>
          <button className="table-button danger" onClick={deleteDocument} disabled={actionDisabled}>
            {busyAction === "delete" ? "Deleting..." : "Delete"}
          </button>
        </>
      )}

      <div className="detail-action-note">{editSummary}</div>
      {status && <div className="status-banner success compact-banner">{status}</div>}
      {error && <div className="status-banner error compact-banner">{error}</div>}

      {canManage && isEditing && (
        <div className="detail-edit-panel">
          <label>
            Extraction JSON
            <textarea value={draftJson} onChange={(event) => setDraftJson(event.target.value)} spellCheck={false} />
          </label>
          <button className="primary-button small-button" onClick={saveEdit} disabled={actionDisabled}>
            {busyAction === "save" ? "Saving..." : "Save edits"}
          </button>
        </div>
      )}
    </div>
  );
}
