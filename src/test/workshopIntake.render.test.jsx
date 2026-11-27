import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import intakeEn from '../locales/en/workshopStatusIntake.json'

// Workshop Status -> Vehicle intake panel. Real pure logic and kit; the
// intake API, settings and the current user are mocked.
const DICT = { workshopStatusIntake: intakeEn }
function tr(key, vars) {
  let cur = DICT
  for (const part of key.split('.')) cur = cur && typeof cur === 'object' ? cur[part] : undefined
  if (typeof cur !== 'string') return key
  return vars ? cur.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : cur
}
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: tr, language: 'en', dir: 'ltr' }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../lib/api/workshopStatusNotifications', () => ({ getCurrentUserId: vi.fn(async () => 'me') }))
const api = vi.hoisted(() => ({
  listIntake: vi.fn(), confirmIntake: vi.fn(), returnIntake: vi.fn(), setIntakeOutcome: vi.fn(), releaseIntake: vi.fn(),
  setIntakeJobCard: vi.fn(), listRoster: vi.fn(async () => []), listRosterCandidates: vi.fn(async () => []),
  saveRosterEntry: vi.fn(), listAnomalies: vi.fn(async () => []), listIntakeSheets: vi.fn(async () => []),
  registerIntakeSheet: vi.fn(), lookupFleet: vi.fn(async () => new Map()), upsertIntakeRows: vi.fn(),
}))
vi.mock('../lib/api/workshopIntake', () => api)

import IntakePanel, { intakeViews } from '../components/workshopStatus/IntakePanel'

const base = { current_active: true, country: 'KSA', site: 'NHC', updated_at: '2026-11-28T08:00:00Z', intake_source: 'sheet' }
const ROWS = [
  { ...base, id: 'r1', asset_no: 'TM701', confirm_status: 'pending_confirm', routed_to: ['me'], submitted_by: 'other', submitted_by_name: 'Ali' },
  { ...base, id: 'r2', asset_no: 'TM628', confirm_status: 'pending_confirm', routed_to: ['me'], submitted_by: 'me', submitted_by_name: 'Me' },
]

beforeEach(() => {
  cleanup(); vi.clearAllMocks()
  api.listIntake.mockResolvedValue({ rows: ROWS, truncated: false })
})

describe('intakeViews', () => {
  it('shows only what the server allows', () => {
    expect(intakeViews({ view: true, intake: true })).toEqual(['sheet', 'list'])
    expect(intakeViews({ view: true, intake_confirm: true, roster: true })).toEqual(['waiting', 'list', 'roster'])
    expect(intakeViews({})).toEqual([])
  })
})

describe('IntakePanel waiting view', () => {
  it('lists vehicles routed to me and refuses my own entry', async () => {
    render(<IntakePanel permissions={{ view: true, intake_confirm: true }} permState="ready" initialView="waiting" />)
    await screen.findByText('TM701')
    const buttons = screen.getAllByRole('button', { name: 'Confirm' })
    expect(buttons[0]).not.toBeDisabled()
    expect(buttons[1]).toBeDisabled()
    expect(screen.getByText(intakeEn.waiting.ownEntry)).toBeTruthy()
  })

  it('confirms through the RPC and reloads', async () => {
    api.confirmIntake.mockResolvedValue({ results: [{ id: 'r1', outcome: 'confirmed' }] })
    render(<IntakePanel permissions={{ view: true, intake_confirm: true }} permState="ready" initialView="waiting" />)
    await screen.findByText('TM701')
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0])
    await waitFor(() => expect(api.confirmIntake).toHaveBeenCalledWith(['r1']))
    await screen.findByText('1 confirmed.')
    expect(api.listIntake).toHaveBeenCalledTimes(2)
  })

  it('needs a reason to return a vehicle', async () => {
    render(<IntakePanel permissions={{ view: true, intake_confirm: true }} permState="ready" initialView="waiting" />)
    await screen.findByText('TM701')
    fireEvent.click(screen.getAllByRole('button', { name: 'Return' })[0])
    const dialog = await screen.findByRole('dialog')
    const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Return')
    expect(submit).toBeDisabled()
    fireEvent.change(dialog.querySelector('textarea'), { target: { value: 'Wrong site entered' } })
    expect(submit).not.toBeDisabled()
  })

  it('shows an error with retry when the list fails', async () => {
    api.listIntake.mockRejectedValue(new Error('boom'))
    render(<IntakePanel permissions={{ view: true, intake_confirm: true }} permState="ready" initialView="waiting" />)
    await screen.findByText(intakeEn.loadErrorTitle)
  })

  it('denies without permission', () => {
    render(<IntakePanel permissions={{}} permState="ready" />)
    expect(screen.getByText(intakeEn.deniedTitle)).toBeTruthy()
  })
})
