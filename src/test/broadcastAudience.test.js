import { describe, it, expect } from 'vitest'
import {
  searchKey, matchesQuery, buildRoleOptions, buildCountryOptions, buildSiteDirectory,
  buildEmployeeOptions, serverRoleMatch, serverCountryMatch, serverSiteMatch,
  pruneSelection, unknownSelections, isEveryone, audienceSummary, aliasMap, canonicalSite,
} from '../lib/broadcastAudience'

const ORG = 'org-a'
const OTHER = 'org-b'
const person = (o) => ({ approved: true, locked: false, organisation_id: ORG, country: ['KSA'], sites: ['NHC'], ...o })

const profiles = [
  person({ id: '1', full_name: 'Ali Khan', username: 'ali', employee_id: 'E-100', role: 'Tyre Man', site: 'NHC' }),
  person({ id: '2', full_name: 'Sara', username: 'sara', employee_id: 'E-101', role: 'Tyre Man', sites: ['YARD'] }),
  person({ id: '3', full_name: 'عَبْدُ الله', username: 'abdullah', employee_id: 'E-102', role: 'Tire Planning Engineer', country: ['UAE'], sites: ['JED'] }),
  person({ id: '4', full_name: 'Locked One', role: 'Locked Role', locked: true }),
  person({ id: '5', full_name: 'Pending', role: 'Pending Role', approved: false }),
  person({ id: '6', full_name: 'Foreign', role: 'Foreign Role', organisation_id: OTHER, country: ['Qatar'] }),
  person({ id: '7', full_name: 'Maintenance', role: 'Workshop Maintenance Area Manager', country: [], sites: ['ALL'] }),
]

describe('job roles come from the real data', () => {
  const opts = buildRoleOptions({
    profiles, orgId: ORG,
    customRoles: [{ name: 'Fleet Supervisor', active: true, organisation_id: ORG }, { name: 'Retired', active: false }, { name: 'Alien', organisation_id: OTHER }],
  })
  const values = opts.map((o) => o.value)

  it('offers distinct roles of eligible people in this organisation plus active custom roles', () => {
    expect(values).toEqual(['Fleet Supervisor', 'Tire Planning Engineer', 'Tyre Man', 'Workshop Maintenance Area Manager'])
  })

  it('never offers locked, unapproved, foreign-org, inactive or another org custom roles', () => {
    for (const bad of ['Locked Role', 'Pending Role', 'Foreign Role', 'Retired', 'Alien']) expect(values).not.toContain(bad)
  })

  it('is not a static list: a new role in the data appears, a removed one vanishes', () => {
    const more = buildRoleOptions({ profiles: [...profiles, person({ id: '9', role: 'Brand New Role' })], orgId: ORG })
    expect(more.map((o) => o.value)).toContain('Brand New Role')
    expect(buildRoleOptions({ profiles: [], customRoles: [], orgId: ORG })).toEqual([])
  })

  it('counts people per role and keeps custom roles with nobody yet', () => {
    expect(opts.find((o) => o.value === 'Tyre Man').count).toBe(2)
    expect(opts.find((o) => o.value === 'Fleet Supervisor')).toMatchObject({ count: 0, custom: true })
  })

  it('every selectable role is spelled exactly as the backend filters on it (p.role = any(p_roles))', () => {
    for (const o of opts.filter((x) => !x.custom || x.count > 0)) {
      const hit = profiles.filter((p) => p.organisation_id === ORG && p.approved && !p.locked && serverRoleMatch(p, [o.value]))
      expect(hit.length).toBe(o.count)
      expect(hit.every((p) => p.role === o.value)).toBe(true)
    }
  })

  it('documents why case and spelling must not be normalised: the server compares exactly', () => {
    expect(profiles.some((p) => serverRoleMatch(p, ['tyre man']))).toBe(false)
    expect(profiles.some((p) => serverRoleMatch(p, ['Tyre  Man']))).toBe(false)
    expect(profiles.some((p) => serverRoleMatch(p, ['Tyre Man']))).toBe(true)
  })

  it('keeps case variants stored in the data as separate exact values', () => {
    const v = buildRoleOptions({ profiles: [person({ id: 'a', role: 'Driver' }), person({ id: 'b', role: 'driver' })], orgId: ORG })
    expect(v.map((o) => o.value).sort()).toEqual(['Driver', 'driver'])
  })
})

describe('countries are those that exist for the organisation', () => {
  const sites = [
    { name: 'NHC', country: 'KSA', organisation_id: ORG, active: true },
    { name: 'DXB', country: 'UAE', organisation_id: ORG, active: false },
    { name: 'DOH', country: 'Qatar', organisation_id: OTHER, active: true },
  ]
  it('derives from active org sites and eligible people only', () => {
    const v = buildCountryOptions({ sites, profiles, orgId: ORG }).map((o) => o.value)
    expect(v).toEqual(['KSA', 'UAE'])
    expect(v).not.toContain('Egypt')
    expect(v).not.toContain('Qatar')
  })
  it('country values match the server overlap test (p.country && p_countries)', () => {
    expect(profiles.filter((p) => serverCountryMatch(p, ['UAE'])).map((p) => p.id)).toContain('3')
    // a person with no country is reached by any country filter, as on the server
    expect(serverCountryMatch(profiles[6], ['UAE'])).toBe(true)
  })
})

describe('site directory', () => {
  const aliases = aliasMap([{ alias: 'REDSEA-ST', canonical: 'RED SEA' }, { alias: 'DHABAN-ST', canonical: 'DHAHBAN' }])
  const sites = [
    { name: 'NHC', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'nhc ', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'NHC-ST', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'Redsea-ST', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'DHABAN-ST', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'Closed Yard', country: 'KSA', active: false, organisation_id: ORG },
    { name: 'Foreign Plant', country: 'KSA', active: true, organisation_id: OTHER },
    { name: 'Shared', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'SHARED', country: 'UAE', active: true, organisation_id: ORG },
    { name: 'DXB', country: 'UAE', active: true, organisation_id: ORG },
    { name: 'DIRIYAH-ST2', country: 'KSA', active: true, organisation_id: ORG },
  ]
  const dir = (extra = {}) => buildSiteDirectory({ sites, aliases, orgId: ORG, ...extra })

  it('applies normalize_site rules: upper, trim, aliases, store suffix', () => {
    expect(canonicalSite(' nhc-st ', aliases)).toBe('NHC')
    expect(canonicalSite('Redsea-ST', aliases)).toBe('RED SEA')
    expect(canonicalSite('DIRIYAH-ST2', aliases)).toBe('DIRIYAH-ST2')
  })
  it('de-duplicates variants into one option and drops inactive and foreign-org sites', () => {
    const v = dir().map((o) => o.value)
    expect(v.filter((x) => x === 'NHC')).toHaveLength(1)
    expect(v).toEqual(['DHAHBAN', 'DIRIYAH-ST2', 'DXB', 'NHC', 'RED SEA', 'SHARED'])
    expect(v).not.toContain('CLOSED YARD')
    expect(v).not.toContain('FOREIGN PLANT')
  })
  it('lists every country for a name that exists in several', () => {
    expect(dir().find((o) => o.value === 'SHARED').countries).toEqual(['KSA', 'UAE'])
  })
  it('narrows by selected countries but keeps already chosen sites on offer', () => {
    expect(dir({ countries: ['UAE'] }).map((o) => o.value)).toEqual(['DXB', 'SHARED'])
    expect(dir({ countries: ['UAE'], keep: ['NHC'] }).map((o) => o.value)).toEqual(['DXB', 'NHC', 'SHARED'])
  })
  it('option values hit exactly the profiles the server stores (canonical sites)', () => {
    const staff = [{ id: 'x', sites: ['NHC'] }, { id: 'y', sites: ['RED SEA'] }, { id: 'z', sites: ['ALL'] }, { id: 'w', sites: [] }]
    const nhc = dir().find((o) => o.value === 'NHC').value
    expect(staff.filter((p) => serverSiteMatch(p, [nhc])).map((p) => p.id)).toEqual(['x', 'z', 'w'])
    // the raw registry spelling would have missed the person stored as NHC
    expect(staff.filter((p) => serverSiteMatch(p, ['NHC-ST'])).map((p) => p.id)).toEqual(['z', 'w'])
  })
})

describe('employee search', () => {
  const opts = buildEmployeeOptions({ profiles, orgId: ORG })
  const find = (q) => opts.filter((o) => matchesQuery(`${o.label} ${o.hint} ${o.search}`, q)).map((o) => o.value)
  it('only offers eligible people of this organisation', () => {
    expect(opts.map((o) => o.value).sort()).toEqual(['1', '2', '3', '7'])
  })
  it('finds by name, username, employee id, role and site', () => {
    expect(find('ali')).toEqual(['1'])
    expect(find('abdullah')).toEqual(['3'])
    expect(find('e-101')).toEqual(['2'])
    expect(find('tire planning')).toEqual(['3'])
    expect(find('tyre man nhc')).toEqual(['1'])
    expect(find('jed')).toEqual(['3'])
  })
  it('finds Arabic names regardless of diacritics and letter variants', () => {
    expect(find('عبد الله')).toEqual(['3'])
    expect(find('عبد')).toEqual(['3'])
    expect(searchKey('أحمد')).toBe(searchKey('احمد'))
    expect(searchKey('١٢٣')).toBe('123')
  })
  it('an empty query matches everything and an unknown one nothing', () => {
    expect(find('')).toHaveLength(4)
    expect(find('zzz')).toEqual([])
  })
})

describe('selection helpers', () => {
  it('prunes values that are not on offer, keeping identity when nothing changes', () => {
    const opts = [{ value: 'KSA' }, { value: 'UAE' }]
    const same = ['KSA']
    expect(pruneSelection(same, opts)).toBe(same)
    expect(pruneSelection(['KSA', 'Egypt'], opts)).toEqual(['KSA'])
    expect(unknownSelections(['Egypt'], opts)).toEqual(['Egypt'])
  })
  it('zero selections everywhere means everyone, and is announced', () => {
    expect(isEveryone({})).toBe(true)
    expect(isEveryone({ roles: ['Driver'] })).toBe(false)
    expect(audienceSummary({})).toBe('All job roles | all countries | all sites')
    expect(audienceSummary({ roles: ['A', 'B'], countries: ['KSA'], sites: ['NHC'] })).toBe('2 job roles | KSA | NHC')
  })
})
