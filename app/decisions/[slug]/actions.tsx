"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExtractionResult } from "@/lib/extraction";
import type { StoredDecisionFile } from "@/lib/stored-decisions";

type DecisionDetailActionsProps = {
  document: StoredDecisionFile;
  backLabel: string;
  printLabel: string;
};

async function readActionResponse(response: Response): Promise<{ error?: string }> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return {
      error: response.ok
        ? ""
        : "The server returned a non-JSON error. This usually means the extraction request timed out or the document is too large for one serverless run. Please try again, or edit the existing extraction manually."
    };
  }
}

export function DecisionDetailActions({ document, backLabel, printLabel }: DecisionDetailActionsProps) {
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
      setError(caught instanceof Error ? caught.message : "Re-extraction failed.");
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
      setError(caught instanceof SyntaxError ? "JSON is not valid. Please fix the extraction JSON first." : caught instanceof Error ? caught.message : "Could not save extraction edits.");
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
      setError(caught instanceof Error ? caught.message : "Could not delete document.");
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
      <button className="table-button" onClick={reExtract} disabled={actionDisabled || !canDownloadPdf}>
        {busyAction === "extract" ? "Re-extracting..." : "Re-extract"}
      </button>
      <button className="table-button" onClick={() => setIsEditing((current) => !current)} disabled={actionDisabled}>
        {isEditing ? "Close edit" : "Edit extraction"}
      </button>
      <button className="table-button danger" onClick={deleteDocument} disabled={actionDisabled}>
        {busyAction === "delete" ? "Deleting..." : "Delete"}
      </button>

      <div className="detail-action-note">{editSummary}</div>
      {status && <div className="status-banner success compact-banner">{status}</div>}
      {error && <div className="status-banner error compact-banner">{error}</div>}

      {isEditing && (
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
