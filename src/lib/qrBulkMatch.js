/**
 * Bulk identifier matching for the QR label generator.
 *
 * Somebody has a list of asset codes (TM360, MP093, ...) in a spreadsheet or an
 * email and wants labels for exactly those. This turns that list into a
 * selection over the rows already loaded on the page.
 *
 * THE ONE RULE THAT SHAPES EVERYTHING HERE: a code that resolves to more than
 * one row is NOT matched. `vehicle_fleet` is unique per (org, COUNTRY, asset_no)
 * and asset numbers are a per-country sequence per asset class (V376), so the
 * same code in two countries is usually a DIFFERENT machine - measured live:
 * 239 of 1,377 codes exist in more than one country, and every duplicate code in
 * the register is exactly that case. Picking one silently would print a label
 * for the wrong vehicle, and the label is the thing somebody then sticks on a
 * windscreen. So ambiguity is REPORTED and the person chooses.
 *
 * Nothing is dropped quietly either: a code that matches nothing comes back in
 * `unmatched` so the caller can say which ones, rather than showing a smaller
 * number than the person pasted and leaving them to work out why.
 *
 * Pure - no I/O, no DOM.
 *
 * @module qrBulkMatch
 */

/**
 * Canonical form of an identifier for comparison.
 *
 * Upper-cased with ALL whitespace removed, mirroring the database's own
 * `normalize_asset_no()` (V337/V490). Surrounding quotes (a CSV artifact) are
 * stripped first.
 *
 * The whitespace strip earns its place on the ROW side, not the pasted side:
 * `parseCodes` splits the input on whitespace (a pasted Excel column is
 * newline/tab separated), so a typed `TM 360` is read as two tokens and
 * honestly reported as unmatched - an asset code never contains a space
 * (measured: 0 of 1,617 rows are off-canonical). What it does fix is a STORED
 * value carrying padding, which this register has form for (166 padded
 * `position` rows, padded serials).
 *
 * Serials are deliberately compared the same way: the register carries
 * whitespace-padded and case-split serials (`k507B403590` vs `K507B403590`), and
 * a person searching for their tyre should find it either way - the split then
 * surfaces as an ambiguous match rather than a silent miss.
 *
 * @param {*} v
 * @returns {string} '' when there is nothing usable.
 */
export function canonCode(v) {
  if (v == null) return ''
  return String(v)
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

/**
 * Parse a pasted blob into a de-duplicated list of codes.
 *
 * Accepts anything a person actually pastes: one per line, comma separated,
 * tab separated (an Excel column), semicolons, pipes, or a mix.
 *
 * @param {string} text
 * @returns {{codes: string[], repeated: string[], total: number}}
 *   `codes` in first-seen order; `repeated` are codes that appeared more than
 *   once in the input (worth saying so - a list with repeats usually means two
 *   sheets were pasted together); `total` is how many tokens were read.
 */
export function parseCodes(text) {
  const raw = String(text ?? '').split(/[\s,;|]+/)
  const seen = new Map()
  const codes = []
  let total = 0
  for (const token of raw) {
    const code = canonCode(token)
    if (!code) continue
    total += 1
    const hits = (seen.get(code) || 0) + 1
    seen.set(code, hits)
    if (hits === 1) codes.push(code)
  }
  const repeated = codes.filter((c) => seen.get(c) > 1)
  return { codes, repeated, total }
}

/**
 * Pull codes out of a parsed spreadsheet's array-of-arrays.
 *
 * Every cell is a candidate, so a file with a stray header row or a second
 * column of notes still yields its codes - the words from those cells simply
 * come back as unmatched and are reported.
 *
 * @param {Array<Array<*>>} aoa
 * @returns {{codes: string[], repeated: string[], total: number}}
 */
export function codesFromRows(aoa) {
  const flat = []
  for (const row of Array.isArray(aoa) ? aoa : []) {
    for (const cell of Array.isArray(row) ? row : [row]) {
      if (cell == null || cell === '') continue
      flat.push(String(cell))
    }
  }
  return parseCodes(flat.join('\n'))
}

/**
 * Resolve codes against the rows already loaded on the page.
 *
 * @param {string[]} codes           canonical or raw - canonicalised here.
 * @param {Array<Object>} rows       loaded records.
 * @param {Object} [opts]
 * @param {(row: Object) => *} [opts.getCode]  reads the identifier off a row.
 * @returns {{
 *   matched:   Array<{code: string, row: Object}>,
 *   ambiguous: Array<{code: string, rows: Object[]}>,
 *   unmatched: string[],
 *   ids:       Array<*>,
 *   counts:    {asked: number, matched: number, ambiguous: number, unmatched: number}
 * }}
 */
export function matchCodes(codes, rows, opts = {}) {
  const getCode = opts.getCode || ((r) => r?.asset_no)
  const index = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = canonCode(getCode(row))
    if (!key) continue
    const bucket = index.get(key)
    if (bucket) bucket.push(row)
    else index.set(key, [row])
  }

  const matched = []
  const ambiguous = []
  const unmatched = []
  const asked = []
  const seen = new Set()

  for (const raw of Array.isArray(codes) ? codes : []) {
    const code = canonCode(raw)
    if (!code || seen.has(code)) continue
    seen.add(code)
    asked.push(code)
    const hits = index.get(code)
    if (!hits || hits.length === 0) unmatched.push(code)
    else if (hits.length === 1) matched.push({ code, row: hits[0] })
    else ambiguous.push({ code, rows: hits.slice() })
  }

  return {
    matched,
    ambiguous,
    unmatched,
    ids: matched.map((m) => m.row?.id),
    counts: {
      asked: asked.length,
      matched: matched.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
    },
  }
}

/**
 * One plain sentence describing a match result.
 *
 * Says what was NOT found as well as what was, because a bare "42 matched" on a
 * list of 50 reads as success.
 *
 * @param {ReturnType<typeof matchCodes>} result
 * @param {string} [noun='code']
 * @returns {string}
 */
export function matchSummary(result, noun = 'code') {
  const c = result?.counts
  if (!c || c.asked === 0) return `No ${noun}s to look up.`
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const parts = [`${plural(c.matched, noun)} matched of ${c.asked}`]
  if (c.ambiguous) parts.push(`${plural(c.ambiguous, noun)} found in more than one place`)
  if (c.unmatched) parts.push(`${plural(c.unmatched, noun)} not in the register`)
  return `${parts.join(', ')}.`
}

/**
 * A short label distinguishing two rows that share a code, for the ambiguity
 * list. Country first - that is what actually differs (V376).
 *
 * @param {Object} row
 * @returns {string}
 */
export function rowWhere(row) {
  return [row?.country, row?.site, row?.vehicle_type].filter(Boolean).join(' - ') || 'no location recorded'
}

export default { canonCode, parseCodes, codesFromRows, matchCodes, matchSummary, rowWhere }
