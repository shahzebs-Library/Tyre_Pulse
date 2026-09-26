/**
 * Pure helpers for the console Organisations page.
 *
 * Status precedence is deliberate: a locked organisation reads Locked even if
 * it is also marked active, because lock is the stronger fact (nobody can sign
 * in). Inactive means not active and not locked.
 */
export function orgStatus(org) {
  if (!org) return 'Inactive'
  if (org.locked) return 'Locked'
  return org.active ? 'Active' : 'Inactive'
}

export function summarizeOrgs(orgs = []) {
  const list = Array.isArray(orgs) ? orgs : []
  const byPlan = {}
  const countries = new Set()
  let active = 0, locked = 0, inactive = 0
  for (const o of list) {
    const st = orgStatus(o)
    if (st === 'Locked') locked += 1
    else if (st === 'Active') active += 1
    else inactive += 1
    const plan = o?.plan || 'unset'
    byPlan[plan] = (byPlan[plan] || 0) + 1
    const cs = Array.isArray(o?.countries) && o.countries.length ? o.countries : (o?.country ? [o.country] : [])
    for (const c of cs) if (c) countries.add(String(c))
  }
  return { total: list.length, active, locked, inactive, byPlan, countries: countries.size }
}
