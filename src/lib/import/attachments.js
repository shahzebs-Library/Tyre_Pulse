/**
 * Import Center — accident ZIP attachment ingestion & matching (Phase 3).
 *
 * An operator uploads a `.zip` evidence package (photos / police reports /
 * invoices / quotations / insurance docs) for an ACCIDENT import. We:
 *   1. read the ZIP entirely client-side (no server round-trip to expand it),
 *   2. filter to safe, sane entries (size + count caps, extension allow-list),
 *   3. match each file to a staged accident row by claim no / police report no /
 *      asset no (normalised, separator-insensitive), and
 *   4. hand the extracted blobs to the service layer for PRIVATE upload + a row
 *      in `import_attachment_matches`.
 *
 * Pure, deterministic helpers live here; all I/O (storage upload, DB insert)
 * stays in `src/lib/api/imports.js`. Unmatched files are NEVER dropped — they
 * are uploaded and recorded with status 'unmatched' so evidence is preserved
 * and can be reconciled later.
 *
 * @module import/attachments
 */

/** Per-file byte cap (25 MB). Anything larger is rejected with a warning. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024
/** Maximum number of files extracted from a single ZIP (DoS / zip-bomb guard). */
export const MAX_ENTRIES = 500
/**
 * Extensions we accept inside the evidence package. Nested ZIPs are intentionally
 * NOT recursed — a `.zip` entry is rejected with a warning rather than expanded,
 * to bound work and avoid zip-bomb amplification.
 * @type {ReadonlyArray<string>}
 */
export const ALLOWED_EXTENSIONS = Object.freeze([
  'jpg', 'jpeg', 'png', 'heic', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
])

/**
 * MIME hints by extension — best-effort content type for the storage upload.
 * @type {Record<string,string>}
 */
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * @typedef {Object} ExtractedFile
 * @property {string} name      Base filename (no directory component).
 * @property {string} path      Full path inside the ZIP (folders preserved).
 * @property {Blob}   blob      File bytes as a Blob (with a best-effort MIME type).
 * @property {string} ext       Lower-case extension without the dot.
 * @property {number} sizeBytes Uncompressed size in bytes.
 */

/**
 * @typedef {Object} ExtractResult
 * @property {ExtractedFile[]} files     Accepted, in-spec files.
 * @property {string[]}        warnings  Human-readable reasons for skipped entries.
 */

/** Lower-case extension (no dot) for a filename, or '' when none. */
export function extOf(name) {
  const base = String(name || '').split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** Base filename (strip any directory component). */
function baseName(path) {
  return String(path || '').split('/').pop() || ''
}

/**
 * True for ZIP entries we must ignore regardless of extension: directories,
 * macOS resource forks (`__MACOSX/…`, `._foo`), and dotfiles (`.DS_Store`).
 * @param {string} path
 * @param {boolean} isDir
 */
function isJunkEntry(path, isDir) {
  if (isDir) return true
  const parts = String(path || '').split('/')
  if (parts.includes('__MACOSX')) return true
  const base = parts[parts.length - 1] || ''
  if (!base) return true
  if (base.startsWith('.')) return true // dotfiles incl. ._resourceforks, .DS_Store
  return false
}

/**
 * Read a ZIP File/Blob entirely in the browser and return the in-spec files
 * plus a collected list of warnings for everything skipped. Never throws on a
 * bad individual entry — only on a structurally unreadable ZIP.
 *
 * Caps applied (in order): junk filtered → extension allow-list → per-file size
 * → total entry count. The entry-count cap counts only accepted files.
 *
 * @param {File|Blob} file  The uploaded `.zip`.
 * @returns {Promise<ExtractResult>}
 */
export async function extractZip(file) {
  if (!file) throw new Error('No ZIP file provided.')
  // Lazy-load jszip so the wizard bundle stays lean for non-accident imports.
  const { default: JSZip } = await import('jszip')

  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch (err) {
    throw new Error(`Could not read the ZIP archive: ${err?.message || 'unknown error'}`)
  }

  /** @type {ExtractedFile[]} */
  const files = []
  /** @type {string[]} */
  const warnings = []

  // Deterministic order: sort by path so matching/recording is reproducible.
  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const path = entry.name
    if (isJunkEntry(path, entry.dir)) continue

    const name = baseName(path)
    const ext = extOf(name)

    if (!ext) {
      warnings.push(`Skipped "${name}" — no file extension.`)
      continue
    }
    if (ext === 'zip') {
      warnings.push(`Skipped "${name}" — nested ZIP archives are not expanded.`)
      continue
    }
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      warnings.push(`Skipped "${name}" — .${ext} files are not allowed.`)
      continue
    }

    const declaredSize = entry._data?.uncompressedSize
    if (typeof declaredSize === 'number' && declaredSize > MAX_FILE_BYTES) {
      warnings.push(`Skipped "${name}" — ${formatMB(declaredSize)} exceeds the ${formatMB(MAX_FILE_BYTES)} per-file limit.`)
      continue
    }

    if (files.length >= MAX_ENTRIES) {
      warnings.push(`Stopped after ${MAX_ENTRIES} files — the archive contains more; remaining entries were skipped.`)
      break
    }

    let blob
    try {
      blob = await entry.async('blob')
    } catch (err) {
      warnings.push(`Skipped "${name}" — could not read entry (${err?.message || 'unknown error'}).`)
      continue
    }

    const sizeBytes = blob.size
    if (sizeBytes > MAX_FILE_BYTES) {
      warnings.push(`Skipped "${name}" — ${formatMB(sizeBytes)} exceeds the ${formatMB(MAX_FILE_BYTES)} per-file limit.`)
      continue
    }

    const typed = MIME_BY_EXT[ext]
      ? new Blob([blob], { type: MIME_BY_EXT[ext] })
      : blob

    files.push({ name, path, blob: typed, ext, sizeBytes })
  }

  return { files, warnings }
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Aggressive identifier normaliser for filename↔row matching: lowercase and
 * strip EVERYTHING that is not a letter/digit (separators, spaces, punctuation).
 * So "CLM-2024/00123" and "clm_2024 00123" both become "clm202400123".
 * Arabic-Indic / Eastern digits are folded to ASCII so mixed-script claim numbers match.
 *
 * @param {*} s
 * @returns {string}
 */
export function normaliseId(s) {
  let str = String(s ?? '')
  // Fold Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to ASCII.
  str = str.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * The match priority, highest first. Each entry maps a staged-row field to the
 * `match_kind` recorded in `import_attachment_matches`.
 * @type {ReadonlyArray<{ field: string, kind: string }>}
 */
export const MATCH_FIELDS = Object.freeze([
  { field: 'insurance_claim_no', kind: 'claim_no' },
  { field: 'police_report_no', kind: 'police_report_no' },
  { field: 'asset_no', kind: 'asset_no' },
])

/**
 * @typedef {Object} AttachmentMatch
 * @property {number} rowIndex   Index into the staged `rows` array.
 * @property {string} matchedBy  The `match_kind` (claim_no | police_report_no | asset_no).
 * @property {string} matchValue The normalised identifier that matched.
 */

/**
 * Match a filename to a staged accident row. Priority order: insurance claim no,
 * then police report no, then asset no. Comparison is on the normalised
 * identifier (case-insensitive, separators ignored): a row's identifier is a
 * match when it appears as a substring of the normalised filename (this is how
 * operators name evidence — e.g. "claim 12345 front.jpg"). Longer identifiers
 * win ties so a 3-char asset no never shadows a full claim no.
 *
 * Staged rows are the wizard's annotated rows; the matchable identifiers live in
 * `row.transformed` (canonical target → value). A `row.transformed` shape is
 * assumed but `row.mapped`/`row` are also probed as a fallback so the matcher is
 * resilient to the exact staged-row container.
 *
 * @param {string} filename
 * @param {Array<Object>} rows   Staged accident rows.
 * @returns {AttachmentMatch|null}  Best match, or null when nothing matches.
 */
export function matchAttachment(filename, rows) {
  const haystack = normaliseId(filename)
  if (!haystack || !Array.isArray(rows) || rows.length === 0) return null

  /** @type {AttachmentMatch|null} */
  let best = null

  rows.forEach((row, rowIndex) => {
    for (const { field, kind } of MATCH_FIELDS) {
      const raw = pickField(row, field)
      const id = normaliseId(raw)
      if (!id) continue
      if (haystack === id || haystack.includes(id)) {
        const candidate = { rowIndex, matchedBy: kind, matchValue: id }
        if (isBetterMatch(candidate, best)) best = candidate
        // Found this row's highest-priority field; don't let a lower-priority
        // field on the SAME row override it.
        break
      }
    }
  })

  return best
}

/**
 * A candidate beats the incumbent when its field has higher priority, or — at
 * equal priority — when its matched identifier is longer (more specific).
 */
function isBetterMatch(candidate, incumbent) {
  if (!incumbent) return true
  const ci = priorityIndex(candidate.matchedBy)
  const ii = priorityIndex(incumbent.matchedBy)
  if (ci !== ii) return ci < ii
  return candidate.matchValue.length > incumbent.matchValue.length
}

function priorityIndex(kind) {
  const i = MATCH_FIELDS.findIndex((m) => m.kind === kind)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/**
 * Read a canonical field off a staged row, probing the transformed layer first
 * (canonical target → value), then mapped, then the row itself.
 * @param {Object} row
 * @param {string} field
 * @returns {*}
 */
function pickField(row, field) {
  if (!row || typeof row !== 'object') return undefined
  return row.transformed?.[field] ?? row.mapped?.[field] ?? row[field]
}

/**
 * Build the bulk-insert payload for `import_attachment_matches` from extracted
 * files, their match results, and the storage references returned by upload.
 * `match_key` is the normalised filename; `matched_entity_type` is 'accident'
 * for matched files; unmatched files carry status 'unmatched' with no entity.
 *
 * @param {Object} params
 * @param {string} params.batchId
 * @param {Array<{ file: ExtractedFile, match: AttachmentMatch|null, fileId?: string|null, error?: string|null }>} params.items
 * @param {Array<Object>} params.rows   Staged rows (for resolving the matched entity id).
 * @returns {Array<Object>}             Rows ready for recordAttachmentMatches().
 */
export function buildMatchRows({ batchId, items, rows }) {
  return items.map(({ file, match, fileId }) => {
    const matched = match != null
    const entityId = matched ? resolveEntityId(rows?.[match.rowIndex], match) : null
    return {
      batchId: batchId ?? null,
      fileId: fileId ?? null,
      matchKey: normaliseId(file.name),
      matchKind: matched ? match.matchedBy : 'source_doc',
      matchedEntityType: matched ? 'accident' : null,
      matchedEntityId: entityId,
      status: matched ? 'matched' : 'unmatched',
    }
  })
}

/**
 * The natural identifier of the matched accident row (claim no preferred, then
 * police report, then asset no) — stored as `matched_entity_id` text since the
 * row is still in staging (no live UUID yet).
 */
function resolveEntityId(row, match) {
  if (!row) return null
  const direct = pickField(row, fieldForKind(match.matchedBy))
  if (direct != null && String(direct).trim()) return String(direct).trim()
  for (const { field } of MATCH_FIELDS) {
    const v = pickField(row, field)
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return null
}

function fieldForKind(kind) {
  return MATCH_FIELDS.find((m) => m.kind === kind)?.field ?? 'insurance_claim_no'
}
