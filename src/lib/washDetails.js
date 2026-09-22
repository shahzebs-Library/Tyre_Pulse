import { isCompletedWash } from './washAnalytics'

export const emptyWashDetails = () => ({ version: 1, chemical_status: 'not_recorded', chemicals: [] })
export const entryPerson = row => row.entry_name || row.entry_username || (row.created_by ? `User ${row.created_by}` : 'Unknown')
export function canonicalWashValue(value) {
  if(Array.isArray(value)) return value.map(canonicalWashValue)
  if(value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalWashValue(value[k])]))
  return value ?? null
}
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
  return d
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
