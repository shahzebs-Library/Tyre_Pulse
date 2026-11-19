import { normalizePartNumber } from '../oemPartsExtractor'

// A repeat is only a repeat when everything that can differ in fitment agrees: same figure line,
// quantity and remark. Same part number with another quantity or serial note is a separate record.
const key = (r) => [r.printed_page || r.source_pdf_page, r.index_no || `v${r.parent_index || ''}`, normalizePartNumber(r.part_no), r.quantity ?? '', String(r.remark || '').trim()].join('|')
const lineKey = (r) => [r.printed_page || r.source_pdf_page, r.index_no || `v${r.parent_index || ''}`, normalizePartNumber(r.part_no)].join('|')

/** Drop exact repeats of the same figure line (page continuations parsed twice, re-read pages). */
export function dedupeRows(rows) {
  const seen = new Map()
  const dropped = []
  for (const r of rows) {
    const k = key(r)
    const prev = seen.get(k)
    if (prev) {
      dropped.push(r)
      if (String(r.description || '').length > String(prev.description || '').length) Object.assign(prev, r)
    } else seen.set(k, { ...r })
  }
  return { rows: [...seen.values()], dropped }
}

/** Compare a new revision with the stored rows of an older one (figure + index + part number key). */
export function diffRevisions(oldRows, newRows) {
  const o = new Map(oldRows.map((r) => [lineKey(r), r]))
  const n = new Map(newRows.map((r) => [lineKey(r), r]))
  const added = [...n.keys()].filter((k) => !o.has(k)).map((k) => n.get(k))
  const removed = [...o.keys()].filter((k) => !n.has(k)).map((k) => o.get(k))
  const changed = [...n.keys()].filter((k) => o.has(k)).map((k) => ({ before: o.get(k), after: n.get(k) }))
    .filter(({ before, after }) => before.description !== after.description || Number(before.quantity) !== Number(after.quantity))
  return { added, removed, changed }
}

/** Deterministic content fingerprint so re-importing an identical parse is a no-op. */
export async function rowsFingerprint(rows) {
  const text = rows.map((r) => [r.printed_page, r.index_no, r.parent_index, normalizePartNumber(r.part_no), r.quantity].join(':')).sort().join('\n')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
