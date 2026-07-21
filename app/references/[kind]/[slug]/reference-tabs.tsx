"use client";

import { useState, type ReactNode } from "react";

type RegulationReferenceTabsProps = {
  summary: ReactNode;
  provisions: ReactNode;
  relations: ReactNode;
  documents: ReactNode;
};

type TabKey = "summary" | "provisions" | "relations" | "documents";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "summary", label: "Ringkasan" },
  { key: "provisions", label: "Ketentuan" },
  { key: "relations", label: "Relasi" },
  { key: "documents", label: "Dokumen & Tanya" }
];

export function RegulationReferenceTabs({ summary, provisions, relations, documents }: RegulationReferenceTabsProps) {
  const [active, setActive] = useState<TabKey>("summary");
  const panels: Record<TabKey, ReactNode> = { summary, provisions, relations, documents };

  return (
    <section className="reference-workspace-tabs">
      <div className="reference-workspace-tablist" role="tablist" aria-label="Bagian referensi peraturan">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`reference-panel-${tab.key}`}
            className={active === tab.key ? "active" : ""}
            onClick={() => setActive(tab.key)}
          >
            <span>{index + 1}</span>
            {tab.label}
          </button>
        ))}
      </div>
      <div id={`reference-panel-${active}`} className={`reference-workspace-panel reference-workspace-panel-${active}`} role="tabpanel">
        {panels[active]}
      </div>
    </section>
  );
}
