import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  preview: vi.fn(),
  send: vi.fn(),
  ensure: vi.fn(),
}))
const ORG = 'org-a'
const dir = {
  errors: [],
  aliases: new Map([['NHC-ST', 'NHC']]),
  customRoles: [{ name: 'Fleet Supervisor', active: true, organisation_id: ORG }],
  profiles: [
    { id: 'u1', full_name: 'Ali Khan', username: 'ali', employee_id: 'E1', role: 'Tyre Man', country: ['KSA'], sites: ['NHC'], approved: true, locked: false, organisation_id: ORG },
    { id: 'u2', full_name: 'Sara', username: 'sara', employee_id: 'E2', role: 'Driver', country: ['UAE'], sites: ['DXB'], approved: true, locked: false, organisation_id: ORG },
  ],
  sites: [
    { name: 'NHC', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'NHC-ST', country: 'KSA', active: true, organisation_id: ORG },
    { name: 'DXB', country: 'UAE', active: true, organisation_id: ORG },
    { name: 'Foreign', country: 'KSA', active: true, organisation_id: 'other' },
  ],
}

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me', organisation_id: ORG } }) }))
vi.mock('../components/illustrations/Illustration', () => ({ default: () => null }))
vi.mock('../components/team/MessageEngagement', () => ({ default: () => null }))
vi.mock('../lib/api/actionCenter', () => ({ ensureActionItem: (...a) => h.ensure(...a), listActionItems: vi.fn(async () => []) }))
vi.mock('../lib/api/broadcast', async (orig) => ({
  ...await orig(),
  loadAudienceDirectory: vi.fn(async () => dir),
  listBroadcasts: vi.fn(async () => []),
  previewAudience: (...a) => h.preview(...a),
  sendBroadcast: (...a) => h.send(...a),
}))

const Broadcast = (await import('../pages/Broadcast')).default
const mount = () => render(<MemoryRouter><Broadcast /></MemoryRouter>)
const sendBtn = () => screen.getByRole('button', { name: /^Send$/ })
const field = (name) => screen.getByRole('combobox', { name })

beforeEach(() => {
  h.preview.mockReset(); h.send.mockReset(); h.ensure.mockReset()
  h.ensure.mockImplementation(async (v) => ({ item: { id: v.source, title: v.title, status: 'open' }, created: true }))
  h.preview.mockResolvedValue({ ok: true, total: 2, with_app: 1, by_role: [] })
  h.send.mockResolvedValue({ ok: true, id: 'm1', recipients: 2, pushes_queued: 1 })
})

describe('Message the team audience', () => {
  it('offers only roles, countries and sites that exist for the organisation', async () => {
    mount()
    await waitFor(() => expect(h.preview).toHaveBeenCalled())
    fireEvent.focus(field('Job role'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Driver'), expect.stringContaining('Fleet Supervisor'), expect.stringContaining('Tyre Man'),
    ])
    fireEvent.pointerDown(document.body)
    fireEvent.focus(field('Country'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['KSA', 'UAE']) // no static Egypt
    fireEvent.pointerDown(document.body)
    fireEvent.focus(field('Site'))
    const sites = screen.getAllByRole('option').map((o) => o.textContent)
    expect(sites).toHaveLength(2) // NHC + NHC-ST de-duplicated, foreign org site absent
    expect(sites.join(' ')).not.toContain('Foreign')
  })

  it('treats no filter as everyone and requires an explicit confirmation to send', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } })
    await waitFor(() => expect(screen.getByText(/recipients in the app/)).toHaveTextContent('2'))
    expect(sendBtn()).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /No filter is selected/ }))
    expect(sendBtn()).toBeEnabled()
  })

  it('sends the exactly spelled selections that were previewed, and invalidates the preview on change', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } })
    await waitFor(() => expect(h.preview).toHaveBeenCalled())
    fireEvent.focus(field('Job role'))
    fireEvent.click(screen.getByRole('option', { name: /Tyre Man/ }))
    fireEvent.pointerDown(document.body)
    // the new selection has its own preview call and the old result cannot authorise sending
    await waitFor(() => expect(h.preview).toHaveBeenLastCalledWith({ roles: ['Tyre Man'], countries: [], sites: [] }))
    await waitFor(() => expect(sendBtn()).toBeEnabled())
    // a pending preview disables Send again
    let release
    h.preview.mockImplementationOnce(() => new Promise((r) => { release = r }))
    fireEvent.focus(field('Country'))
    fireEvent.click(screen.getByRole('option', { name: 'KSA' }))
    await waitFor(() => expect(sendBtn()).toBeDisabled())
    release({ ok: true, total: 1, with_app: 1, by_role: [] })
    await waitFor(() => expect(sendBtn()).toBeEnabled())
    fireEvent.click(sendBtn())
    await waitFor(() => expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      roles: ['Tyre Man'], countries: ['KSA'], sites: [],
    })))
  })

  it('blocks sending when the server preview finds nobody', async () => {
    h.preview.mockResolvedValue({ ok: true, total: 0, with_app: 0, by_role: [] })
    mount()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } })
    await waitFor(() => expect(h.preview).toHaveBeenCalled())
    fireEvent.focus(field('Job role'))
    fireEvent.click(screen.getByRole('option', { name: /Driver/ }))
    await waitFor(() => expect(within(document.body).getByText(/No active recipients match/)).toBeInTheDocument())
    expect(sendBtn()).toBeDisabled()
  })

  it('creates one follow-up task per chosen person from the registered site list', async () => {
    mount()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Body' } })
    await waitFor(() => expect(h.preview).toHaveBeenCalled())
    fireEvent.focus(field('Job role'))
    fireEvent.click(screen.getByRole('option', { name: /Tyre Man/ }))
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(sendBtn()).toBeEnabled())
    fireEvent.click(sendBtn())
    const people = await screen.findByRole('combobox', { name: 'Responsible people' })
    // site is a registered-site dropdown, not free text
    const siteSelect = screen.getByLabelText('Site (optional)')
    expect(siteSelect.tagName).toBe('SELECT')
    expect(within(siteSelect).getAllByRole('option').map((o) => o.value)).toEqual(['', 'DXB', 'NHC'])
    fireEvent.change(siteSelect, { target: { value: 'NHC' } })
    fireEvent.focus(people)
    fireEvent.change(people, { target: { value: 'E1' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^Select all 1 matching/ }))
    fireEvent.change(people, { target: { value: 'sara' } })
    fireEvent.click(screen.getByRole('button', { name: /^Select all 1 matching/ }))
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2999-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: /Create 2 Action Center tasks/ }))
    await waitFor(() => expect(h.ensure).toHaveBeenCalledTimes(2))
    expect(h.ensure.mock.calls.map(([v]) => v.source)).toEqual(['broadcast:m1:u1', 'broadcast:m1:u2'])
    expect(h.ensure.mock.calls[0][0].site).toBe('NHC')
    await screen.findByText(/2 of 2 tasks created/)
  })
})
