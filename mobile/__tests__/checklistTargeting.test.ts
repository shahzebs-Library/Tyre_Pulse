/**
 * Checklist role targeting + icon resolution on the phone.
 *
 * These two engines decide WHICH checklists a person is offered and WHETHER the
 * card draws anything at all, and both had a real defect before V591:
 *   - every signed-in user was shown every published template, and
 *     `checklist_assignments.assignee_role` was read by nobody;
 *   - `<Ionicons name={tpl.icon}>` was handed an emoji or a lucide component
 *     name and drew a blank square for four of the six live templates.
 */
import {
  templateAllowsRole, filterTemplatesForRole,
  assignmentAllowsRole, filterAssignmentsForRole,
  normaliseRoleKey, roleTargetLabel, isOversightRole,
} from '../lib/checklistRoles'
import {
  resolveChecklistIcon, checklistIonicon, isEmojiIcon, tokenFromName,
  CHECKLIST_ICON_TOKENS, DEFAULT_CHECKLIST_ICON,
} from '../lib/checklistIcons'

// The exact icon + category values measured in the live database.
const LIVE_TEMPLATES = [
  { name: 'a', category: 'Workshop', icon: '🔧' },
  { name: 'Fleet Transit Mixer Checklist', category: 'Inspection', icon: 'ClipboardCheck' },
  { name: 'Maint', category: 'Maintenance', icon: '📋' },
  { name: 'PMD', category: 'Maintenance', icon: '📋' },
  { name: 'Predictive Maintenance Checklist', category: 'Maintenance', icon: null },
  { name: 'Workshop Daily TM Inspection Checklist', category: 'Inspection', icon: 'ClipboardCheck' },
]

describe('checklist role targeting', () => {
  it('shipping role targeting removes nothing from anyone today', () => {
    // Every live template has assignee_roles NULL. If this ever fails, the
    // back-compat promise in V591 has been broken.
    const live = LIVE_TEMPLATES.map((t) => ({ ...t, assignee_roles: null }))
    for (const role of ['tyre_man', 'driver', 'mechanic', 'inspector', 'reporter']) {
      expect(filterTemplatesForRole(live, role)).toHaveLength(6)
    }
  })

  it('matches the DB Title Case role against this app lowercase UserRole', () => {
    // profiles.role is 'Tyre Man'; UserRole is 'tyre_man'. A raw compare between
    // the two matches nothing, so a targeted checklist would vanish for exactly
    // the person it was written for.
    expect(normaliseRoleKey('Tyre Man')).toBe('tyre_man')
    expect(templateAllowsRole({ assignee_roles: ['Tyre Man'] }, 'tyre_man')).toBe(true)
    expect(templateAllowsRole({ assignee_roles: ['Maintenance Supervisor'] }, 'maintenance_supervisor')).toBe(true)
  })

  it('the trades get the workshop sheet and the driver gets theirs', () => {
    const workshop = { name: 'Workshop daily', assignee_roles: ['Mechanic', 'Electrician'] }
    const driver = { name: 'Pre-trip check', assignee_roles: ['Driver'] }
    const shared = { name: 'Site safety', assignee_roles: null }
    const all = [workshop, driver, shared]

    expect(filterTemplatesForRole(all, 'mechanic').map((t) => t.name)).toEqual(['Workshop daily', 'Site safety'])
    expect(filterTemplatesForRole(all, 'driver').map((t) => t.name)).toEqual(['Pre-trip check', 'Site safety'])
    expect(templateAllowsRole(workshop, 'driver')).toBe(false)
  })

  it('a manager still sees every checklist, a mechanic does not', () => {
    const t = { assignee_roles: ['Electrician'] }
    expect(isOversightRole('manager')).toBe(true)
    expect(templateAllowsRole(t, 'manager')).toBe(true)
    expect(templateAllowsRole(t, 'director')).toBe(true)
    expect(templateAllowsRole(t, 'mechanic')).toBe(false)
    expect(templateAllowsRole(t, 'anything', { isSuperAdmin: true })).toBe(true)
  })

  it('a loading profile does not unlock a targeted checklist', () => {
    expect(templateAllowsRole({ assignee_roles: ['Mechanic'] }, null)).toBe(false)
    // ...but an untargeted one still shows, so the list is never blank while
    // the profile is in flight.
    expect(templateAllowsRole({ assignee_roles: null }, null)).toBe(true)
  })

  it('assignments honour assignee_role, and a null one stays open to all', () => {
    const rows = [
      { assignee_role: 'Mechanic' },
      { assignee_role: 'Driver' },
      { assignee_role: null },
    ]
    expect(filterAssignmentsForRole(rows, 'mechanic')).toEqual([rows[0], rows[2]])
    expect(assignmentAllowsRole(rows[2], 'reporter')).toBe(true)
    expect(assignmentAllowsRole(rows[1], 'mechanic')).toBe(false)
  })

  it('roleTargetLabel is null for an untargeted checklist', () => {
    expect(roleTargetLabel({ assignee_roles: null })).toBeNull()
    expect(roleTargetLabel({ assignee_roles: ['Mechanic', 'Electrician'] })).toBe('Mechanic, Electrician')
  })
})

describe('checklist icon resolution', () => {
  it('every live template resolves to a REAL Ionicons glyph', () => {
    // The glyph map is the authority. Guessing a name is how the blank square
    // shipped in the first place.
    const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json')
    for (const t of LIVE_TEMPLATES) {
      const r = resolveChecklistIcon(t)
      expect(CHECKLIST_ICON_TOKENS).toContain(r.token)
      expect(Object.prototype.hasOwnProperty.call(glyphs, r.ionicon)).toBe(true)
    }
  })

  it('the two lucide-named templates no longer render blank', () => {
    const r = resolveChecklistIcon({ icon: 'ClipboardCheck', category: 'Inspection' })
    expect(r.kind).toBe('icon')
    expect(r.ionicon).toBe('clipboard-outline')
    expect(tokenFromName('ClipboardCheck')).toBe('clipboard')
  })

  it('an emoji stays an emoji and still carries a drawable fallback', () => {
    const r = resolveChecklistIcon({ icon: '🔧', category: 'Workshop' })
    expect(r.kind).toBe('emoji')
    expect(r.emoji).toBe('🔧')
    expect(r.token).toBe('wrench')
    expect(r.ionicon).toBe('construct-outline')
  })

  it('falls back category then name, and never guesses a trade from nothing', () => {
    expect(resolveChecklistIcon({ icon: null, category: 'Electrical' }).token).toBe('bolt')
    expect(resolveChecklistIcon({ name: 'Daily tyre pressure round' }).token).toBe('tyre')
    expect(resolveChecklistIcon({}).token).toBe(DEFAULT_CHECKLIST_ICON)
  })

  it('checklistIonicon can never return an invalid name', () => {
    const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json')
    for (const bad of ['nonsense', '', null, undefined, 'ClipboardCheck']) {
      expect(Object.prototype.hasOwnProperty.call(glyphs, checklistIonicon(bad as any))).toBe(true)
    }
  })

  it('isEmojiIcon does not mistake a name or a blank for an emoji', () => {
    expect(isEmojiIcon('🔧')).toBe(true)
    for (const v of ['ClipboardCheck', 'wrench', '', '  ', null]) expect(isEmojiIcon(v)).toBe(false)
  })
})
