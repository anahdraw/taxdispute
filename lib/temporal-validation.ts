import type { SearchHit } from "./search-contracts";

export type TemporalIntent = {
  required: boolean;
  asOf?: string;
  explicit: boolean;
  reason: "explicit-date" | "explicit-year" | "current-law" | "none";
};

export type TemporalValidation = {
  valid: boolean;
  intent: TemporalIntent;
  eligibleSourceIds: string[];
  excludedSourceIds: string[];
  uncertainSourceIds: string[];
  reasons: string[];
};

const CURRENT_LAW = /\b(?:berlaku|tidak\s+berlaku|saat\s+ini|sekarang|terbaru|status|dicabut|diubah|perubahan|efektif|as\s+of|current|in\s+force|effective|revoked|amended)\b/i;
const PRACTICAL_CURRENT = /\b(?:bagaimana\s+(?:cara\s+)?menghitung|cara\s+menghitung|berapa\s+tarif|kapan\s+(?:bayar|setor|lapor)|how\s+to\s+calculate|what\s+rate|filing\s+deadline)\b/i;
const EXPLICIT_DATE = /\b((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const EXPLICIT_YEAR = /\b(?:masa\s+pajak|tahun\s+pajak|periode|transaksi|sejak|untuk\s+tahun|tax\s+year|tax\s+period|transaction\s+in|as\s+of)\D{0,16}((?:19|20)\d{2})\b/i;

function isoDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

export function resolveTemporalIntent(question: string, explicitAsOf?: string, now = new Date()): TemporalIntent {
  const supplied = isoDate(explicitAsOf);
  if (explicitAsOf && !supplied) throw new Error("asOf must be a valid date.");
  if (supplied) return { required: true, asOf: supplied, explicit: true, reason: "explicit-date" };
  const exactDate = String(question || "").match(EXPLICIT_DATE)?.[0];
  if (exactDate) return { required: true, asOf: exactDate, explicit: true, reason: "explicit-date" };
  const year = String(question || "").match(EXPLICIT_YEAR)?.[1];
  if (year) return { required: true, asOf: `${year}-12-31`, explicit: true, reason: "explicit-year" };
  if (CURRENT_LAW.test(question) || PRACTICAL_CURRENT.test(question)) {
    return { required: true, asOf: now.toISOString().slice(0, 10), explicit: false, reason: "current-law" };
  }
  return { required: false, explicit: false, reason: "none" };
}

function dateWithin(source: SearchHit, asOf: string) {
  const target = Date.parse(asOf);
  const from = source.effectiveFrom ? Date.parse(source.effectiveFrom) : Number.NaN;
  const to = source.effectiveTo ? Date.parse(source.effectiveTo) : Number.NaN;
  if (Number.isFinite(from) && target < from) return false;
  if (Number.isFinite(to) && target > to) return false;
  return true;
}

function eligibleStatus(source: SearchHit, intent: TemporalIntent) {
  if (source.corpus !== "regulation") return true;
  const status = String(source.metadata.legalStatus || "unknown");
  if (!intent.explicit || intent.reason === "current-law") {
    return ["active", "amended", "partially_revoked"].includes(status);
  }
  // A revoked rule may be relevant to a historical period only when its
  // validity end is known. Without that boundary it remains uncertain.
  if (status === "revoked") return Boolean(source.effectiveTo);
  return ["active", "amended", "partially_revoked"].includes(status);
}

export function validateTemporalSources(question: string, sources: readonly SearchHit[], options: { asOf?: string; now?: Date } = {}): TemporalValidation {
  const intent = resolveTemporalIntent(question, options.asOf, options.now);
  if (!intent.required || !intent.asOf) {
    return { valid: true, intent, eligibleSourceIds: sources.map((source) => source.id), excludedSourceIds: [], uncertainSourceIds: [], reasons: [] };
  }

  const regulations = sources.filter((source) => source.corpus === "regulation");
  const eligibleSourceIds: string[] = [];
  const excludedSourceIds: string[] = [];
  const uncertainSourceIds: string[] = [];
  for (const source of regulations) {
    const knownStatus = String(source.metadata.legalStatus || "unknown") !== "unknown";
    const knownStart = Boolean(source.effectiveFrom || source.metadata.effectiveDate);
    if (!knownStatus || !knownStart || (String(source.metadata.legalStatus) === "revoked" && !source.effectiveTo)) {
      uncertainSourceIds.push(source.id);
      continue;
    }
    if (eligibleStatus(source, intent) && dateWithin(source, intent.asOf)) eligibleSourceIds.push(source.id);
    else excludedSourceIds.push(source.id);
  }

  const reasons: string[] = [];
  if (!regulations.length) reasons.push("Tidak ada sumber peraturan untuk memvalidasi masa berlaku.");
  if (!eligibleSourceIds.length) reasons.push(`Tidak ada sumber dengan status dan rentang berlaku terverifikasi pada ${intent.asOf}.`);
  if (uncertainSourceIds.length) reasons.push(`${uncertainSourceIds.length} sumber belum memiliki metadata temporal lengkap.`);
  return { valid: eligibleSourceIds.length > 0, intent, eligibleSourceIds, excludedSourceIds, uncertainSourceIds, reasons };
}
