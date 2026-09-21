export const CHECK_RESULTS = { not_checked: 'Not checked', pass: 'Checked', fail: 'Issue found', na: 'Not applicable' }
export const WASH_CHECKS = ['Exterior surfaces', 'Windows, mirrors and lights', 'Wheels and wheel arches', 'Cab interior', 'Final rinse and visible residue']
export const emptyWashDetails = () => ({ version: 1, chemical_status: 'not_recorded', chemicals: [], checklist: WASH_CHECKS.map(label => ({ label, result: 'not_checked', note: '' })) })
export const entryPerson = row => row.entry_name || row.entry_username || (row.created_by ? `User ${row.created_by}` : 'Unknown')
export function canonicalWashValue(value) {
  if(Array.isArray(value)) return value.map(canonicalWashValue)
  if(value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalWashValue(value[k])]))
  return value ?? null
}
export const checklistSummary = row => {
  const checks = row.wash_details?.checklist || []
  if (!checks.length) return 'Not recorded'
  const issues = checks.filter(c => c.result === 'fail').length
  return issues ? `${issues} issue(s)` : `${checks.filter(c => c.result === 'pass').length} checked / ${checks.length} items`
}
export function validateWashDetails(d) {
  if (d == null) return null
  if (d.version !== 1 || !['not_recorded', 'none', 'used'].includes(d.chemical_status) || !Array.isArray(d.chemicals) || !Array.isArray(d.checklist)) throw new Error('Invalid wash details.')
  if (d.chemicals.length > 10 || d.checklist.length > 30) throw new Error('Use at most 10 chemicals and 30 checklist items.')
  if (d.chemical_status === 'used' && !d.chemicals.length) throw new Error('Add the chemical product used.')
  if (d.chemical_status !== 'used' && d.chemicals.length) throw new Error('Confirm whether chemicals were used.')
  for (const c of d.chemicals) {
    if (!c.name?.trim() || c.name.length > 160) throw new Error('Enter a chemical product name (up to 160 characters).')
    if (c.sds_url && !/^https:\/\/\S+$/.test(c.sds_url)) throw new Error('The safety data sheet link must use HTTPS.')
  }
  for (const c of d.checklist) {
    if (!c.label?.trim() || c.label.length > 200 || !Object.hasOwn(CHECK_RESULTS, c.result)) throw new Error('Check each checklist item and result.')
    if (c.result === 'fail' && !c.note?.trim()) throw new Error('Describe each checklist issue.')
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
    if (row.status === 'Completed') p.completed++
    if (row.status === 'Scheduled') p.scheduled++
    p.assets.add(JSON.stringify([row.organisation_id, row.country, row.asset_no]))
    if (row.created_at > p.last) p.last = row.created_at
    people.set(id, p)
  }
  return [...people.values()].map(p => ({ ...p, vehicles: p.assets.size })).sort((a,b) => b.entries-a.entries || a.name.localeCompare(b.name))
}
