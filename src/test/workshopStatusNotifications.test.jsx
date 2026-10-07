import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import wsn from '../locales/en/workshopStatusNotifications.json'
import wsnAr from '../locales/ar/workshopStatusNotifications.json'
import ws from '../locales/en/workshopStatus.json'
import common from '../locales/en/common.json'
import {
  isWorkshopNotification, workshopNotificationLink, focusFilters, sortWorkshopNotices, WORKSHOP_FOCUS,
} from '../lib/workshopStatus/notificationLinks'
import { UNASSIGNED } from '../lib/workshopStatus/activeView'

// Workshop Status notifications (Loop 12): pure deep links, the notices strip
// and the Active vehicles deep-link focus.

const DICT = { workshopStatusNotifications: wsn, workshopStatus: ws, common }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../lib/api/workshopStatusNotifications', () => ({
  listMyWorkshopNotifications: vi.fn(),
  markWorkshopNotificationsRead: vi.fn(async () => []),
  getCurrentUserId: vi.fn(async () => 'u1'),
}))
vi.mock('../lib/api/workshopStatusActive', () => ({ loadActiveVehicles: vi.fn() }))

import WorkshopNotificationsPanel from '../components/workshopStatus/WorkshopNotificationsPanel'
import ActiveVehiclesPanel from '../components/workshopStatus/ActiveVehiclesPanel'
import { listMyWorkshopNotifications, markWorkshopNotificationsRead } from '../lib/api/workshopStatusNotifications'
import { loadActiveVehicles } from '../lib/api/workshopStatusActive'

const REC = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('workshop notification links', () => {
  it('recognises only Workshop Status rows', () => {
    expect(isWorkshopNotification({ type: 'workshop_status_upload_mine' })).toBe(true)
    expect(isWorkshopNotification({ type: 'approval' })).toBe(false)
    expect(workshopNotificationLink({ type: 'approval' })).toBeNull()
  })

  it('opens the exact vehicle when the row names a record', () => {
    expect(workshopNotificationLink({ type: 'workshop_status_upload_mine', entity_type: 'workshop_status_record', entity_id: REC }))
      .toBe(`/daily-ops/workshop?record=${REC}`)
    expect(workshopNotificationLink({ type: 'workshop_status_release_today', entityType: 'workshop_status_record', entityId: REC }))
      .toBe(`/daily-ops/workshop?record=${REC}`)
  })

  it('opens the filtered list, the upload tab or the Released tab otherwise', () => {
    expect(workshopNotificationLink({ type: 'workshop_status_upload_mine', entity_type: 'workshop_status_upload', entity_id: REC }))
      .toBe('/daily-ops/workshop?focus=mine')
    expect(workshopNotificationLink({ type: 'workshop_status_update_missing', entity_type: 'workshop_status' }))
      .toBe('/daily-ops/workshop?focus=not_today')
    expect(workshopNotificationLink({ type: 'workshop_status_no_responsible' })).toBe('/daily-ops/workshop?focus=unassigned')
    expect(workshopNotificationLink({ type: 'workshop_status_upload_review', entity_type: 'workshop_status_upload', entity_id: REC }))
      .toBe('/daily-ops/workshop?tab=upload')
    expect(workshopNotificationLink({ type: 'workshop_status_upload_released' })).toBe('/daily-ops/workshop?tab=removed')
    expect(workshopNotificationLink({ type: 'workshop_status_record', entity_type: 'workshop_status_record', entity_id: 'not-a-uuid' }))
      .toBe('/daily-ops/workshop')
  })

  it('every kind the server writes has a link the client understands', () => {
    const sql = readFileSync('supabase/migrations/20261007140000_workshop_status_notifications.sql', 'utf8')
    const kinds = [...new Set(sql.match(/'workshop_status_[a-z_]+'/g).map((s) => s.slice(1, -1)))]
      .filter((k) => /_(upload_(mine|unassigned|released|review)|update_missing|waiting_long|long_down|release_today|release_overdue|no_responsible|missing_eta|ready_release)$/.test(k))
    expect(kinds.length).toBeGreaterThanOrEqual(12)
    for (const k of kinds) expect(workshopNotificationLink({ type: k })).toMatch(/^\/daily-ops\/workshop/)
    const literal = [...sql.matchAll(/focus=([a-z_]+)'/g)].map((m) => m[1])
    const block = sql.slice(sql.indexOf("?focus=' || case g.kind"))
    const fromCase = [...block.slice(0, block.indexOf('end;')).matchAll(/(?:then|else) '([a-z_]+)'/g)].map((m) => m[1])
    expect(literal.length + fromCase.length).toBeGreaterThan(5)
    for (const f of [...literal, ...fromCase]) expect(WORKSHOP_FOCUS).toContain(f)
  })

  it('maps focus presets to filters; mine needs a user', () => {
    expect(focusFilters('mine', 'u1')).toEqual({ responsible: 'u1' })
    expect(focusFilters('mine', null)).toBeNull()
    expect(focusFilters('unassigned')).toEqual({ responsible: UNASSIGNED })
    expect(focusFilters('over7')).toEqual({ minDays: 7 })
    expect(focusFilters('bogus')).toBeNull()
  })

  it('sorts unread first then newest and caps the list', () => {
    const out = sortWorkshopNotices([
      { id: 'a', type: 'workshop_status_x', read: true, created_at: '2026-10-07T10:00:00Z' },
      { id: 'b', type: 'workshop_status_x', read: false, created_at: '2026-10-06T10:00:00Z' },
      { id: 'c', type: 'workshop_status_x', read: false, created_at: '2026-10-07T09:00:00Z' },
      { id: 'd', type: 'approval', read: false, created_at: '2026-10-08T09:00:00Z' },
    ], 2)
    expect(out.map((r) => r.id)).toEqual(['c', 'b'])
  })

  it('Arabic carries every English key', () => {
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
    expect(keys(wsnAr).sort()).toEqual(keys(wsn).sort())
    expect(JSON.stringify(wsn)).not.toMatch(/removed/i)
  })
})

describe('WorkshopNotificationsPanel', () => {
  const ROWS = [
    { id: 'n1', type: 'workshop_status_upload_mine', title: 'Workshop report KSA: 1 vehicle needs your update today', body: 'Assigned to you: TM1.', entity_type: 'workshop_status_record', entity_id: REC, read: false, created_at: '2026-10-07T08:00:00Z' },
    { id: 'n2', type: 'workshop_status_no_responsible', title: '2 vehicles have no responsible person', body: 'TM4, TM5.', read: false, created_at: '2026-10-07T07:00:00Z' },
  ]

  it('renders nothing when there is nothing unread', async () => {
    vi.mocked(listMyWorkshopNotifications).mockResolvedValue({ rows: [], userId: 'u1' })
    const { container } = render(<WorkshopNotificationsPanel onOpen={vi.fn()} />)
    await waitFor(() => expect(listMyWorkshopNotifications).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('lists notices, opens the deep link and marks read', async () => {
    vi.mocked(listMyWorkshopNotifications).mockResolvedValue({ rows: ROWS, userId: 'u1' })
    const onOpen = vi.fn()
    render(<WorkshopNotificationsPanel onOpen={onOpen} />)
    expect(await screen.findByText(ROWS[0].title)).toBeTruthy()
    expect(screen.getByText('2 unread')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Open: ${ROWS[0].title}` }))
    expect(onOpen).toHaveBeenCalledWith(`/daily-ops/workshop?record=${REC}`)
    expect(markWorkshopNotificationsRead).toHaveBeenCalledWith(['n1'])
    await waitFor(() => expect(screen.queryByText(ROWS[0].title)).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: wsn.markAll }))
    await waitFor(() => expect(markWorkshopNotificationsRead).toHaveBeenLastCalledWith(['n2']))
  })

  it('shows a retry line when the read fails', async () => {
    vi.mocked(listMyWorkshopNotifications).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ rows: ROWS, userId: 'u1' })
    render(<WorkshopNotificationsPanel onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: wsn.retry }))
    expect(await screen.findByText(ROWS[1].title)).toBeTruthy()
  })
})

describe('Active vehicles deep-link focus', () => {
  const RECS = [
    { id: REC, asset_no: 'TM1', country: 'KSA', site: 'NHC', complaint: 'Gearbox' },
    { id: 'r2', asset_no: 'TM2', country: 'KSA', site: 'JED', complaint: 'Brakes' },
  ]

  it('opens the exact vehicle from ?record=', async () => {
    vi.mocked(loadActiveVehicles).mockResolvedValue({ rows: RECS, truncated: false })
    const onClear = vi.fn()
    render(<ActiveVehiclesPanel permissions={{ view: true }} permState="ready"
      focus={{ key: `record:${REC}`, recordId: REC }} onClearFocus={onClear} />)
    expect(await screen.findByText('Showing vehicle TM1.')).toBeTruthy()
    expect(screen.getByRole('searchbox').value).toBe('TM1')
    fireEvent.click(screen.getByRole('button', { name: wsn.focus.clear }))
    expect(onClear).toHaveBeenCalled()
    expect(screen.getByRole('searchbox').value).toBe('')
  })

  it('says so when the linked vehicle left the report', async () => {
    vi.mocked(loadActiveVehicles).mockResolvedValue({ rows: RECS, truncated: false })
    render(<ActiveVehiclesPanel permissions={{ view: true }} permState="ready"
      focus={{ key: 'record:gone', recordId: '99999999-2222-3333-4444-555555555555' }} />)
    expect(await screen.findByText(wsn.focus.recordGone)).toBeTruthy()
  })

  it('applies a filter preset', async () => {
    vi.mocked(loadActiveVehicles).mockResolvedValue({ rows: RECS, truncated: false })
    render(<ActiveVehiclesPanel permissions={{ view: true }} permState="ready"
      focus={{ key: 'focus:unassigned', name: 'unassigned', filters: { responsible: UNASSIGNED } }} />)
    expect(await screen.findByText(wsn.focus.unassigned)).toBeTruthy()
  })
})
