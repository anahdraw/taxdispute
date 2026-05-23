"use client";

export function DecisionDetailActions({ backLabel, printLabel }: { backLabel: string; printLabel: string }) {
  return (
    <>
      <a className="table-button" href="/?page=database">
        {backLabel}
      </a>
      <button className="table-button" onClick={() => window.print()}>
        {printLabel}
      </button>
    </>
  );
}
