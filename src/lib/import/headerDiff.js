/**
 * What changed in this file's columns since last time, and who decides.
 *
 * The app already remembers a mapping per format via a header fingerprint. When
 * the fingerprint MATCHES, the saved mapping is applied silently, which is
 * right. When it does NOT match, nothing was said at all - the user just got a
 * freshly guessed mapping with no hint that the file they upload every day had
 * changed shape. A column quietly renamed or dropped upstream would land as a
 * different mapping, or as nothing, without anyone being asked.
 *
 * This turns that silence into a decision. Every change is presented with what
 * it was, what it is now, and a choice: keep what we had, or take the new file
 * as it is. Nothing is applied until the person chooses.
 *
 * Pure: no I/O, no dates, no randomness.
 */

/** Compare headers the way a person would: case and spacing are not a change. */
export function normHeader(h) {
  return String(h ?? '')
    .replace(/ /g, ' ')      // the non-breaking space Excel leaves behind
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** How alike are two header names, 0..1. Used only to SUGGEST a rename pair. */
export function similarity(a, b) {
  const x = normHeader(a)
  const y = normHeader(b)
  if (!x || !y) return 0
  if (x === y) return 1
  // token overlap, which handles "Job Card No" -> "Job Card Number" well and
  // does not pretend two unrelated names are related
  const tx = new Set(x.split(' ').filter(Boolean))
  const ty = new Set(y.split(' ').filter(Boolean))
  if (!tx.size || !ty.size) return 0
  let shared = 0
  for (const t of tx) if (ty.has(t)) shared += 1
  const overlap = (2 * shared) / (tx.size + ty.size)
  // a containment bonus: "Total Cost" vs "Total Repair Cost"
  const contains = x.includes(y) || y.includes(x) ? 0.2 : 0
  return Math.min(1, overlap + contains)
}

export const RENAME_THRESHOLD = 0.5

/**
 * Diff the file's columns against the columns the saved mapping was built on.
 *
 * @param {string[]} previous columns the saved profile knows
 * @param {string[]} current  columns in the file just uploaded
 * @returns {{unchanged:string[], added:string[], removed:string[],
 *            renames:Array<{from:string,to:string,score:number}>, hasChanges:boolean}}
 */
export function diffHeaders(previous = [], current = []) {
  const prev = (Array.isArray(previous) ? previous : []).filter((h) => String(h ?? '').trim())
  const cur = (Array.isArray(current) ? current : []).filter((h) => String(h ?? '').trim())

  const prevByNorm = new Map(prev.map((h) => [normHeader(h), h]))
  const curByNorm = new Map(cur.map((h) => [normHeader(h), h]))

  const unchanged = []
  for (const [n, h] of curByNorm) if (prevByNorm.has(n)) unchanged.push(h)

  const addedRaw = cur.filter((h) => !prevByNorm.has(normHeader(h)))
  const removedRaw = prev.filter((h) => !curByNorm.has(normHeader(h)))

  // Pair a disappeared column with a new one only when they genuinely look like
  // the same thing renamed. Greedy best-first, and each side is used once - a
  // suggestion that reuses a column would present the user with a contradiction.
  const pairs = []
  for (const from of removedRaw) {
    for (const to of addedRaw) {
      const score = similarity(from, to)
      if (score >= RENAME_THRESHOLD) pairs.push({ from, to, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  const usedFrom = new Set()
  const usedTo = new Set()
  const renames = []
  for (const p of pairs) {
    if (usedFrom.has(p.from) || usedTo.has(p.to)) continue
    usedFrom.add(p.from); usedTo.add(p.to)
    renames.push(p)
  }

  const added = addedRaw.filter((h) => !usedTo.has(h))
  const removed = removedRaw.filter((h) => !usedFrom.has(h))

  return {
    unchanged,
    added,
    removed,
    renames,
    hasChanges: added.length > 0 || removed.length > 0 || renames.length > 0,
  }
}

/**
 * The columns a saved profile knows about, and how confident we are that this
 * is the WHOLE story. V391 stores the file's full column list; profiles saved
 * before it only have the headers that were actually mapped, so a column the
 * user left unmapped is invisible. Saying which of the two we have is the
 * difference between "3 new columns" and "3 columns your mapping does not use".
 */
export function profileHeaders(profile) {
  const full = Array.isArray(profile?.header_columns) ? profile.header_columns.filter(Boolean) : []
  if (full.length) return { headers: full, complete: true }
  const fromRules = (profile?.rules || []).map((r) => r?.source_header || r?.sourceHeader).filter(Boolean)
  return { headers: fromRules, complete: false }
}

/**
 * Share of the profile's columns still present in this file, 0..1.
 * This is what separates "the daily file changed" from "this is a different
 * report entirely".
 */
export function overlapRatio(profileCols = [], currentCols = []) {
  const prev = profileCols.filter((h) => String(h ?? '').trim())
  if (!prev.length) return 0
  const cur = new Set(currentCols.map(normHeader))
  let hit = 0
  for (const h of prev) if (cur.has(normHeader(h))) hit += 1
  return hit / prev.length
}

/**
 * Below this, the file is a DIFFERENT report, not a changed one. Comparing them
 * would present a page of invented renames and removals about a format the user
 * never claimed was the same, so we stay silent and let the auto-mapper work.
 */
export const MIN_OVERLAP = 0.5

/**
 * Of the saved profiles for this module, which one is this file a version of.
 * Best overlap wins; nothing wins below MIN_OVERLAP.
 */
export function pickComparableProfile(currentCols = [], profiles = []) {
  let best = null
  for (const p of profiles || []) {
    const { headers, complete } = profileHeaders(p)
    if (!headers.length) continue
    const ratio = overlapRatio(headers, currentCols)
    if (ratio < MIN_OVERLAP) continue
    if (!best || ratio > best.ratio) best = { profile: p, headers, complete, ratio }
  }
  return best
}

/**
 * The decisions a person can make about a change. `keep` means "carry the old
 * mapping across"; `change` means "accept the file as it is".
 */
export const DECISION = Object.freeze({ KEEP: 'keep', CHANGE: 'change' })

/**
 * Default answer per change. Deliberately conservative: a rename defaults to
 * KEEP, because carrying the mapping over is almost always what was meant and
 * is reversible on screen. A removed column defaults to CHANGE, because there
 * is nothing in the file left to map and pretending otherwise would produce a
 * mapping that cannot work.
 */
export function defaultDecisions(diff) {
  const out = {}
  for (const r of diff.renames || []) out[`rename:${r.from}`] = DECISION.KEEP
  for (const h of diff.removed || []) out[`removed:${h}`] = DECISION.CHANGE
  for (const h of diff.added || []) out[`added:${h}`] = DECISION.CHANGE
  return out
}

/**
 * Apply the decisions to the saved mapping rules, producing the mapping to use.
 *
 * @param {Array<{sourceHeader:string, target:string}>} savedRules
 * @param {ReturnType<typeof diffHeaders>} diff
 * @param {Record<string,string>} decisions
 * @returns {Array<{sourceHeader:string, target:string}>} rules keyed to the CURRENT file
 */
export function applyHeaderDecisions(savedRules = [], diff, decisions = {}) {
  const rules = (Array.isArray(savedRules) ? savedRules : []).filter((r) => r && r.sourceHeader)
  const renameFor = new Map()
  const droppedNorm = new Set()
  for (const r of diff?.renames || []) {
    if (decisions[`rename:${r.from}`] === DECISION.KEEP) {
      renameFor.set(normHeader(r.from), r.to)
    } else {
      // Rename REJECTED. The old column is still absent from the file, so its
      // rule has to go too - leaving it would point the mapping at a header
      // that is not there, which is the exact failure this engine exists to
      // prevent. The new column is simply left for the auto-mapper.
      droppedNorm.add(normHeader(r.from))
    }
  }
  for (const h of diff?.removed || []) {
    if (decisions[`removed:${h}`] !== DECISION.KEEP) droppedNorm.add(normHeader(h))
  }

  const out = []
  for (const rule of rules) {
    const n = normHeader(rule.sourceHeader)
    if (renameFor.has(n)) {
      // carry the old target across onto the column's new name
      out.push({ ...rule, sourceHeader: renameFor.get(n), carriedFrom: rule.sourceHeader })
      continue
    }
    if (droppedNorm.has(n)) continue   // the column is gone; do not map a ghost
    out.push(rule)
  }
  return out
}

/** One-line summary for the header of the dialog. */
export function summariseDiff(diff) {
  if (!diff || !diff.hasChanges) return 'This file matches the format you normally upload.'
  const bits = []
  if (diff.renames?.length) bits.push(`${diff.renames.length} column${diff.renames.length === 1 ? '' : 's'} appear renamed`)
  if (diff.added?.length) bits.push(`${diff.added.length} new`)
  if (diff.removed?.length) bits.push(`${diff.removed.length} missing`)
  return `This file is different from the one you normally upload: ${bits.join(', ')}.`
}
