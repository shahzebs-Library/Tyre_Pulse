import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import en from '../locales/en/workshopStatusHistory.json'

// Workshop Status -> Vehicle History Drawer (Loop 9). The real history engine
// and SideDrawer render; only the history service is mocked.

const DICT = { workshopStatusHistory: en }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
vi.mock('../lib/api/workshopStatusHistory', () => ({
  listRecordHistory: vi.fn(),
  resolveHistoryNames: vi.fn(async () => ({})),
}))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: vi.fn(async () => {}),
  reportFileName: (...p) => p.join(' '),
  reportDateLabel: () => '07 Oct 2026',
}))

import VehicleHistoryDrawer from '../components/workshopStatus/VehicleHistoryDrawer'
import { listRecordHistory, resolveHistoryNames } from '../lib/api/workshopStatusHistory'
import { exportToExcel } from '../lib/exportUtils'

const P1 = '00000000-0000-0000-0000-000000000001'
const RECORD = { id: 'r1', asset_no: 'TM100', site: 'NHC', country: 'KSA' }
let n = 0
const ev = (over) => ({
  id: `e${++n}`, record_id: 'r1', asset_no: 'TM100', upload_id: null, event_type: 'field_change',
  field_name: null, old_value: null, new_value: null, reason: null, source: 'manual', details: {},
  actor_id: 'u1', actor_name: 'Ahmed Khan', created_at: '2026-10-06T10:00:00.000000+00:00', ...over,
})
const T1 = '2026-10-06T10:00:00.000000+00:00'
const T2 = '2026-10-05T06:00:00.000000+00:00'
const EVENTS = [
  ev({ event_type: 'manual_update', created_at: T1 }),
  ev({ field_name: 'current_stage', old_value: 'Diagnosis', new_value: 'Waiting for Parts', created_at: T1 }),
  ev({ field_name: 'responsible_user_id', old_value: null, new_value: P1, created_at: T1 }),
  ev({ event_type: 'added', source: 'excel', upload_id: 'up1', actor_id: 'sup', actor_name: 'Sajid Kamboh', created_at: T2 }),
]

const open = () => render(<VehicleHistoryDrawer record={RECORD} open onClose={vi.fn()} />)

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  resolveHistoryNames.mockResolvedValue({ [P1]: 'Helper Tech' })
})

describe('VehicleHistoryDrawer', () => {
  it('renders grouped entries with names, source and old -> new', async () => {
    listRecordHistory.mockResolvedValue({ events: EVENTS, hasMore: false, nextBefore: null, nextInclusive: false })
    open()
    const list = await screen.findByTestId('wks-his-timeline')
    const items = within(list).getAllByRole('listitem').filter((li) => li.classList.contains('wks-his-entry'))
    expect(items).toHaveLength(2)
    const manual = items[0]
    expect(within(manual).getByText('Ahmed Khan')).toBeTruthy()
    expect(within(manual).getByText('Manual')).toBeTruthy()
    expect(within(manual).getByText('Current stage')).toBeTruthy()
    expect(within(manual).getByText('Diagnosis')).toBeTruthy()
    expect(within(manual).getByText('Waiting for Parts')).toBeTruthy()
    await waitFor(() => expect(within(manual).getByText('Helper Tech')).toBeTruthy())
    expect(within(manual).getByText('(blank)')).toBeTruthy()
    expect(within(items[1]).getByText('Sajid Kamboh')).toBeTruthy()
    expect(within(items[1]).getByText('Excel upload')).toBeTruthy()
    expect(within(items[1]).getByText(en.events.added)).toBeTruthy()
    expect(screen.getByText('History of TM100')).toBeTruthy()
  })

  it('filter chips narrow the timeline', async () => {
    listRecordHistory.mockResolvedValue({ events: EVENTS, hasMore: false, nextBefore: null, nextInclusive: false })
    open()
    await screen.findByTestId('wks-his-timeline')
    const chips = screen.getByRole('group', { name: en.drawer.filterLabel })
    fireEvent.click(within(chips).getByRole('button', { name: /Excel import/ }))
    const list = screen.getByTestId('wks-his-timeline')
    expect(within(list).queryByText('Ahmed Khan')).toBeNull()
    expect(within(list).getByText('Sajid Kamboh')).toBeTruthy()
    fireEvent.click(within(chips).getByRole('button', { name: /Assignment/ }))
    expect(within(screen.getByTestId('wks-his-timeline')).getByText('Ahmed Khan')).toBeTruthy()
  })

  it('has no edit or delete controls', async () => {
    listRecordHistory.mockResolvedValue({ events: EVENTS, hasMore: false, nextBefore: null, nextInclusive: false })
    open()
    await screen.findByTestId('wks-his-timeline')
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent + (b.getAttribute('aria-label') || '')).not.toMatch(/edit|delete|remove|undo|save/i)
    }
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(en.drawer.readOnly)).toBeTruthy()
  })

  it('shows the empty state', async () => {
    listRecordHistory.mockResolvedValue({ events: [], hasMore: false, nextBefore: null, nextInclusive: false })
    open()
    expect(await screen.findByTestId('wks-his-empty')).toBeTruthy()
  })

  it('shows an error with Retry that reloads', async () => {
    listRecordHistory.mockRejectedValueOnce(new Error('relation "x" does not exist'))
    listRecordHistory.mockResolvedValueOnce({ events: EVENTS, hasMore: false, nextBefore: null, nextInclusive: false })
    open()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/relation/)
    fireEvent.click(within(alert).getByRole('button', { name: /Retry/ }))
    expect(await screen.findByTestId('wks-his-timeline')).toBeTruthy()
  })

  it('loads older entries with the cursor and exports to Excel', async () => {
    listRecordHistory
      .mockResolvedValueOnce({ events: EVENTS.slice(0, 3), hasMore: true, nextBefore: T2, nextInclusive: true })
      .mockResolvedValueOnce({ events: EVENTS.slice(3), hasMore: false, nextBefore: null, nextInclusive: false })
    open()
    await screen.findByTestId('wks-his-timeline')
    fireEvent.click(screen.getByRole('button', { name: en.drawer.loadMore }))
    await waitFor(() => expect(screen.getByText('Sajid Kamboh')).toBeTruthy())
    expect(listRecordHistory).toHaveBeenLastCalledWith('r1', { limit: 60, before: T2, inclusive: true })
    fireEvent.click(screen.getByRole('button', { name: /Export to Excel/ }))
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled())
    const [rows, cols] = exportToExcel.mock.calls[0]
    expect(cols).toEqual(['at', 'actor', 'source', 'category', 'field', 'old_value', 'new_value', 'reason'])
    expect(rows.find((r) => r.field === 'Responsible person').new_value).toBe('Helper Tech')
  })
})
