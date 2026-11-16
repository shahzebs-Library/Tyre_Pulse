// AI tyre SERIAL-NUMBER reading: DRAFT, additive, feature-flagged path (docs/features/AI_SERIAL_RECOGNITION.md).
//
// Pure module: no Deno globals, no network, no remote imports, so vitest can import it.
// Nothing here runs unless system_config.ai_tyre_serial_enabled = 'true' (default OFF, absent = OFF).
// With the flag off the worker sends the unchanged v4 prompt, records prompt_version 'tyre-photo-v4'
// and writes an analysis object with NO serial key: damage detection is byte-identical.
//
// Safety rules enforced here (never by trusting the model):
//  * The normalised value is DERIVED from the raw text we were shown. The model's own "normalized"
//    field is ignored for the value; if it contains characters the raw text does not, that is flagged.
//  * Uncertain characters must be '?'. Any '?' => status 'partial'. A value is never completed by us.
//  * A tyre size, DOT date code or placeholder is not a serial: such a reading is downgraded.
//  * Nothing here writes tyre records. Comparison happens server-side (SQL mirror of compareSerial)
//    and the only effect of a mismatch / ambiguous / unreadable result is a manual review item.

export type Json = Record<string, unknown>;

export const SERIAL_PROMPT_VERSION = "tyre-photo-v5-serial";
export const SERIAL_SCHEMA_VERSION = "serial-v1";
export const SERIAL_FLAG_KEY = "ai_tyre_serial_enabled";

export const SERIAL_SOURCES = ["label", "moulded", "none"] as const;
export const SERIAL_CONFIDENCES = ["high", "medium", "low"] as const;
export const SERIAL_STATUSES = ["readable", "partial", "unreadable"] as const;
export const SERIAL_OUTCOMES = ["match", "mismatch", "ambiguous", "unreadable", "no_serial_on_record", "weak_serial_on_record"] as const;
/** Outcomes that become a manual review item in the EXISTING AI review queue. */
export const SERIAL_REVIEW_OUTCOMES = ["mismatch", "ambiguous", "unreadable"] as const;

export type SerialSource = typeof SERIAL_SOURCES[number];
export type SerialConfidence = typeof SERIAL_CONFIDENCES[number];
export type SerialStatus = typeof SERIAL_STATUSES[number];
export type SerialOutcome = typeof SERIAL_OUTCOMES[number];

export interface SerialReading {
  schema: string;
  raw: string;               // exactly what the model says it saw (trimmed, max 80), '' when nothing
  normalized: string | null; // derived from raw by normalizeSerialText; null when unreadable
  source: SerialSource;
  confidence: SerialConfidence;
  status: SerialStatus;
  issues: string[];          // why the sanitiser changed anything; empty when it accepted the claim as-is
}

/**
 * Appended to the v4 damage prompt ONLY when the flag is on. Plain ASCII (no dashes beyond '-').
 * It asks for one extra top-level key and repeats the never-invent rule.
 */
export const SERIAL_PROMPT_SECTION =
  " Also include a key serial (object) describing the tyre's own serial number if one is visible: " +
  "raw (string, the characters exactly as printed or moulded, use ? for every character you cannot read with certainty, empty string if none), " +
  "source (label for a printed sticker or paper label, moulded for characters formed in the rubber sidewall, none if no serial is visible), " +
  "confidence (high, medium or low), status (readable, partial or unreadable). " +
  "The serial is the tyre's identification number, NOT the size (for example 315/80R22.5), NOT the DOT week-year code, NOT the brand or pattern name. " +
  "Never guess or complete a character; a partly visible serial is partial with ? in place of each unread character.";

/** The prompt actually sent. Flag off => the base prompt UNCHANGED (same string, byte for byte). */
export function promptFor(basePrompt: string, serialEnabled: boolean): string {
  return serialEnabled ? basePrompt + SERIAL_PROMPT_SECTION : basePrompt;
}

/** Prompt version recorded on the job and used as the reuse-cache key. Flag off => the v4 version. */
export function promptVersionFor(baseVersion: string, serialEnabled: boolean): string {
  return serialEnabled ? SERIAL_PROMPT_VERSION : baseVersion;
}

/** system_config rows -> flag. Only the exact text 'true' (case-insensitive, trimmed) turns it on. */
export function serialFlagFrom(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false;
  const row = rows.find(r => r && typeof r === "object" && (r as Json).key === SERIAL_FLAG_KEY) as Json | undefined;
  if (!row) return false;
  let v = row.value as unknown;
  if (typeof v === "string") { try { const p = JSON.parse(v); if (typeof p === "string" || typeof p === "boolean") v = p; } catch { /* plain text */ } }
  return String(v ?? "").trim().toLowerCase() === "true";
}

/**
 * Comparison form of a serial: upper case, '?' kept, every other non-alphanumeric removed
 * (spaces, hyphens, dots, slashes printed between groups carry no identity).
 * Letter/digit look-alikes (O/0, I/1, S/5, B/8) are NOT folded: folding would let a misread
 * become a "match". Returns '' for nothing.
 */
export function normalizeSerialText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9?]/g, "").slice(0, 40);
}

/**
 * JS mirror of public.tyre_serial_is_strong(text) (production, read 2026-11-16). Used on the READING
 * to refuse sizes, DOT codes and placeholders as serials. CHANGE BOTH if the SQL changes.
 */
export function serialIsStrong(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim().toUpperCase();
  if (s.length < 6 || !/[0-9]/.test(s)) return false;
  if (/^(DOT|NULL|N\/?A|-)/.test(s)) return false;
  if (/^[0-9]{3}\//.test(s)) return false;
  if (/[0-9]{2,3}\/[0-9]{2}\s*R/.test(s)) return false;
  if (/E\+[0-9]+$/.test(s)) return false;
  if (/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /]?[0-9]{2,4}$/.test(s)) return false;
  if (/^[0-9]{2,3}(\.[0-9]+)?\s*R\s*[0-9]{2}(\.[0-9])?($|[^0-9])/.test(s)) return false;
  if (/[,;&]/.test(s)) return false;
  if (/^([0-9])\1+$/.test(s)) return false;
  if (["123456", "1234567", "12345678", "123456789", "1234567890"].includes(s)) return false;
  return true;
}

// Control characters, built without backslash-u escapes (the MCP deploy path decodes them).
const CONTROL_RE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]", "g");

const pick = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (ok as readonly string[]).includes(s) ? s as T : fallback;
};
const unique = (xs: string[]) => Array.from(new Set(xs));

const UNREADABLE = (issues: string[], raw = "", source: SerialSource = "none"): SerialReading =>
  ({ schema: SERIAL_SCHEMA_VERSION, raw, normalized: null, source, confidence: "low", status: "unreadable", issues: unique(issues) });

/**
 * Sanitise the model's serial object. Never throws; anything unusable becomes an unreadable reading.
 * The output can only ever be LESS certain than the claim, never more.
 */
export function sanitizeSerialReading(input: unknown): SerialReading {
  if (input === undefined || input === null) return UNREADABLE(["missing"]);
  if (typeof input !== "object" || Array.isArray(input)) return UNREADABLE(["invalid_shape"]);
  const x = input as Json;
  const issues: string[] = [];
  const raw = typeof x.raw === "string" ? x.raw.replace(CONTROL_RE, " ").trim().slice(0, 80) : "";
  if (typeof x.raw !== "string" && x.raw !== undefined && x.raw !== null) issues.push("raw_not_text");
  let source = pick(x.source, SERIAL_SOURCES, "none");
  let confidence = pick(x.confidence, SERIAL_CONFIDENCES, "low");
  let status = pick(x.status, SERIAL_STATUSES, "unreadable");
  if (typeof x.confidence === "string" && !SERIAL_CONFIDENCES.includes(x.confidence.trim().toLowerCase() as SerialConfidence)) issues.push("confidence_unknown");
  if (typeof x.status === "string" && !SERIAL_STATUSES.includes(x.status.trim().toLowerCase() as SerialStatus)) issues.push("status_unknown");

  const normalized = normalizeSerialText(raw);
  // The model's own normalized value is evidence only: characters it adds beyond the raw text are invention.
  if (typeof x.normalized === "string") {
    const claimed = normalizeSerialText(x.normalized);
    if (claimed && claimed !== normalized) issues.push("model_normalized_differs_from_raw");
  }
  if (!normalized || source === "none" || status === "unreadable") {
    if (normalized && status !== "unreadable") issues.push("source_none_with_text");
    return UNREADABLE(issues, raw, normalized ? source : "none");
  }
  const known = normalized.replace(/\?/g, "");
  if (known.length === 0) return UNREADABLE([...issues, "no_readable_character"], raw, source);
  if (normalized.includes("?") && status === "readable") { status = "partial"; issues.push("uncertain_characters"); }
  if (normalized.length < 6 && status === "readable") { status = "partial"; issues.push("too_short"); }
  if (!normalized.includes("?") && (!serialIsStrong(raw) || !serialIsStrong(normalized))) {
    // A size, DOT code, placeholder or junk is never a readable serial.
    if (status === "readable") { status = "partial"; }
    issues.push("not_a_strong_serial");
  }
  if (status === "partial" && confidence === "high") { confidence = "medium"; issues.push("partial_confidence_capped"); }
  if (source === "moulded" && confidence === "high" && status !== "readable") confidence = "medium";
  return { schema: SERIAL_SCHEMA_VERSION, raw, normalized, source, confidence, status, issues: unique(issues) };
}

/** Pull the serial object out of the raw model text (same tolerant parse as the damage path). Never throws. */
export function extractSerialFromOutput(output: unknown, parse: (text: string) => unknown): SerialReading {
  try {
    const obj = parse(String(output ?? ""));
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return sanitizeSerialReading((obj as Json).serial);
  } catch { /* fall through */ }
  return UNREADABLE(["unparseable_output"]);
}

/** What the register says is on that wheel on the inspection day (built server-side by the position service). */
export interface RegisteredSerial {
  /** 'resolved' only when the photo's slot resolved to ONE wheel of the asset's layout. */
  positionStatus: "resolved" | "ambiguous" | "unknown" | "inconsistent";
  /** Distinct serials of tyre records fitted to that wheel on that day (trimmed, as stored). */
  serials: string[];
}

export interface SerialComparison { outcome: SerialOutcome; reason: string; needsReview: boolean; registered: string | null }

/** Is a partial reading (with '?') consistent with a registered serial? Same length, every known char equal. */
export function partialConsistent(reading: string, registered: string): boolean {
  if (reading.length !== registered.length) return false;
  for (let i = 0; i < reading.length; i++) if (reading[i] !== "?" && reading[i] !== registered[i]) return false;
  return true;
}

/**
 * Pure comparison. SQL mirror: public.ai_tyre_serial_outcome (pending migration 20261117130000).
 * Order matters and is pinned by tests:
 *  1. wheel not resolved / two different registered serials  -> ambiguous (the record side is unclear)
 *  2. nothing registered on that wheel                        -> no_serial_on_record
 *  3. registered serial is weak (size, DOT, placeholder)      -> weak_serial_on_record
 *  4. reading unreadable                                      -> unreadable
 *  5. readable and equal                                      -> match
 *  6. partial consistent with the record                      -> ambiguous (cannot confirm)
 *  7. readable low-confidence and different                   -> ambiguous
 *  8. otherwise different                                     -> mismatch
 */
export function compareSerial(reading: SerialReading, record: RegisteredSerial): SerialComparison {
  const out = (outcome: SerialOutcome, reason: string, registered: string | null = null): SerialComparison =>
    ({ outcome, reason, registered, needsReview: (SERIAL_REVIEW_OUTCOMES as readonly string[]).includes(outcome) });
  if (record.positionStatus !== "resolved") return out("ambiguous", "wheel_not_resolved");
  const regs = unique((record.serials ?? []).map(s => String(s ?? "").trim()).filter(Boolean));
  const strong = regs.filter(serialIsStrong);
  if (!regs.length) return out("no_serial_on_record", "no_tyre_on_wheel");
  if (!strong.length) return out("weak_serial_on_record", "registered_serial_weak", regs[0]);
  const strongNorm = unique(strong.map(normalizeSerialText));
  if (strongNorm.length > 1) return out("ambiguous", "several_serials_on_wheel");
  const reg = strongNorm[0];
  if (reading.status === "unreadable" || !reading.normalized) return out("unreadable", "serial_not_readable", strong[0]);
  if (reading.status === "readable" && reading.normalized === reg) {
    return reading.confidence === "low" ? out("ambiguous", "low_confidence_match", strong[0]) : out("match", "same_serial", strong[0]);
  }
  if (reading.status === "partial") {
    return partialConsistent(reading.normalized, reg)
      ? out("ambiguous", "partial_consistent", strong[0])
      : out("mismatch", "partial_conflicts", strong[0]);
  }
  if (reading.confidence === "low") return out("ambiguous", "low_confidence_different", strong[0]);
  return out("mismatch", "different_serial", strong[0]);
}
