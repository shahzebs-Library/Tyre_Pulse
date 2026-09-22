import { isCompletedWash } from './washAnalytics'

/**
 * `checklist` is carried even though no screen captures a washing checklist
 * yet: the server CHECK `wash_details_valid` (20260921085115) requires it to be
 * a JSON array, and an absent key is read by Postgres as NULL, which failed the
 * constraint with 23514 ("Some values are not valid.") on every save. An empty
 * list is the honest value - nothing was recorded. Mirrors the SQL; change both.
 */
export const emptyWashDetails = () => ({ version: 1, chemical_status: 'not_recorded', chemicals: [], checklist: [] })
export const entryPerson = row => row.entry_name || row.entry_username || (row.created_by ? `User ${row.created_by}` : 'Unknown')
export function canonicalWashValue(value) {
  if(Array.isArray(value)) return value.map(canonicalWashValue)
  if(value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalWashValue(value[k])]))
  return value ?? null
}

/**
 * Compare-shape for a stored wash_details value. A row written before the
 * `checklist` key existed carries no key at all, while the payload we now send
 * always carries an empty one. Both mean "no checklist recorded", so the retry
 * check must not read that as a wash whose details changed - doing so would
 * refuse an identical retry with "already saved with different details".
 */
export function comparableWashDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return canonicalWashValue(value)
  return canonicalWashValue({ ...value, checklist: Array.isArray(value.checklist) ? value.checklist : [] })
}
/** Checklist results the server CHECK accepts. Mirrors the SQL; change both. */
export const WASH_CHECK_RESULTS = ['not_checked', 'pass', 'fail', 'na']

export function validateWashDetails(d) {
  if (d == null) return null
  if (d.version !== 1 || !['not_recorded', 'none', 'used'].includes(d.chemical_status) || !Array.isArray(d.chemicals)) throw new Error('Invalid wash details.')
  if (d.chemicals.length > 10) throw new Error('Use at most 10 chemicals.')
  if (d.chemical_status === 'used' && !d.chemicals.length) throw new Error('Add the chemical product used.')
  if (d.chemical_status !== 'used' && d.chemicals.length) throw new Error('Confirm whether chemicals were used.')
  for (const c of d.chemicals) {
    if (!c.name?.trim() || c.name.length > 160) throw new Error('Enter a chemical product name (up to 160 characters).')
    if (c.sds_url && !/^https:\/\/\S+$/.test(c.sds_url)) throw new Error('The safety data sheet link must use HTTPS.')
  }
  // A missing checklist means nothing was recorded, so it is normalised to []
  // rather than rejected - an older draft loaded from a saved row must still be
  // savable. Items are rebuilt as strings so a non-string value can never reach
  // the server CHECK, which requires each field to be a JSON string.
  const source = Array.isArray(d.checklist) ? d.checklist : []
  if (source.length > 30) throw new Error('Use at most 30 checklist items.')
  const checklist = source.map((item) => {
    const label = String(item?.label ?? '').trim()
    if (!label || label.length > 200) throw new Error('Each checklist item needs a label of up to 200 characters.')
    const result = String(item?.result ?? '')
    if (!WASH_CHECK_RESULTS.includes(result)) throw new Error('Each checklist item needs a recorded result.')
    const note = String(item?.note ?? '')
    if (note.length > 1000) throw new Error('A checklist note must be 1000 characters or fewer.')
    if (result === 'fail' && !note.trim()) throw new Error('A failed checklist item needs a note explaining the fault.')
    return note ? { label, result, note } : { label, result }
  })
  return { ...d, checklist }
}

export function staffWashActivity(rows) {
  const people = new Map(), seen = new Set()
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    const id = row.created_by || 'unknown'
    const p = people.get(id) || { id, name: entryPerson(row), entries: 0, completed: 0, scheduled: 0, assets: new Set(), last: '' }
    p.entries++
    if (isCompletedWash(row)) p.completed++
    if (row.status === 'Scheduled') p.scheduled++
    p.assets.add(JSON.stringify([row.organisation_id, row.country, row.asset_no]))
    if (row.created_at > p.last) p.last = row.created_at
    people.set(id, p)
  }
  return [...people.values()].map(p => ({ ...p, vehicles: p.assets.size })).sort((a,b) => b.entries-a.entries || a.name.localeCompare(b.name))
}
