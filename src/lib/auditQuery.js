/**
 * Audit search: one parser for typed qualifiers and the AND / OR builder.
 *
 * Typed syntax:  actor:anum action:update          (all must match)
 *                actor:anum OR actor:sajid         (any may match)
 *                -action:login                     (must NOT match)
 *                "tyre records"                    (free text, all fields)
 * The builder writes the same string with toQueryString(), so there is exactly
 * one way a search means something. Pure, no I/O.
 */

export const QUERY_FIELDS = [
  { key: 'actor', label: 'Who' },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target' },
  { key: 'detail', label: 'Detail' },
  { key: 'reason', label: 'Reason' },
]
const FIELD_KEYS = new Set(QUERY_FIELDS.map((f) => f.key))

export const QUERY_OPS = [
  { key: 'contains', label: 'contains' },
  { key: 'not', label: 'does not contain' },
]

function tokenize(input) {
  const out = []
  const re = /(-?[a-z]+:"[^"]*"|-?[a-z]+:\S+|"[^"]*"|\S+)/gi
  let m
  while ((m = re.exec(String(input || ''))) !== null) out.push(m[1])
  return out
}

function unquote(v) {
  const s = String(v)
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s
}

/**
 * @returns {{ join: 'and'|'or', conditions: Array<{field:string|null, op:'contains'|'not', value:string}> }}
 * field null = free text across every field.
 */
export function parseQuery(input) {
  const tokens = tokenize(input)
  let join = 'and'
  const conditions = []
  for (const t of tokens) {
    const upper = t.toUpperCase()
    if (upper === 'OR') { join = 'or'; continue }
    if (upper === 'AND') continue
    const neg = t.startsWith('-') && t.includes(':')
    const body = neg ? t.slice(1) : t
    const idx = body.indexOf(':')
    const key = idx > 0 ? body.slice(0, idx).toLowerCase() : null
    if (key && FIELD_KEYS.has(key)) {
      const value = unquote(body.slice(idx + 1)).trim()
      if (value) conditions.push({ field: key, op: neg ? 'not' : 'contains', value })
    } else {
      const value = unquote(t).trim()
      if (value) conditions.push({ field: null, op: 'contains', value })
    }
  }
  return { join, conditions }
}

function quoteIfNeeded(v) {
  const s = String(v || '').trim()
  return /\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s
}

/** Builder rows -> the typed query string. Empty values are dropped. */
export function toQueryString(conditions = [], join = 'and') {
  const parts = (conditions || [])
    .filter((c) => String(c?.value || '').trim())
    .map((c) => {
      const v = quoteIfNeeded(c.value)
      if (!c.field) return v
      return `${c.op === 'not' ? '-' : ''}${c.field}:${v}`
    })
  return parts.join(join === 'or' ? ' OR ' : ' ')
}

function fieldText(row, field) {
  if (!row) return ''
  if (field) return String(row[field] ?? '').toLowerCase()
  return [row.actor, row.action, row.target, row.detail, row.reason].filter(Boolean).join(' ').toLowerCase()
}

function condHolds(row, c) {
  const hit = fieldText(row, c.field).includes(String(c.value).toLowerCase())
  return c.op === 'not' ? !hit : hit
}

/** True when the row satisfies the parsed query (an empty query matches all). */
export function matchQuery(row, parsed) {
  const conds = parsed?.conditions || []
  if (!conds.length) return true
  // "must not" conditions always apply, whatever the join.
  const negs = conds.filter((c) => c.op === 'not')
  const pos = conds.filter((c) => c.op !== 'not')
  if (!negs.every((c) => condHolds(row, c))) return false
  if (!pos.length) return true
  return parsed.join === 'or' ? pos.some((c) => condHolds(row, c)) : pos.every((c) => condHolds(row, c))
}

export function filterByQuery(rows = [], input = '') {
  const parsed = parseQuery(input)
  if (!parsed.conditions.length) return rows || []
  return (rows || []).filter((r) => matchQuery(r, parsed))
}

/** "0 of 1,821" style text for the measured reason KPI; N/A with no data. */
export function reasonCoverageText({ total, withReason } = {}) {
  if (total === null || total === undefined || withReason === null || withReason === undefined) return 'N/A'
  return `${Number(withReason).toLocaleString('en-US')} of ${Number(total).toLocaleString('en-US')}`
}
