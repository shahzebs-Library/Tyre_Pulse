import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const preview = vi.hoisted(() => vi.fn())
const signUp = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
const inv = vi.hoisted(() => ({
  listInvitations: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: { signUp, signOut }, rpc: vi.fn(), from: vi.fn() } }))
vi.mock('../lib/api/systemConfig', () => ({ getPublicConfig: () => Promise.resolve({ password_min_length: '8' }) }))
vi.mock('../lib/api/customRoles', () => ({ listAssignableRoles: () => Promise.resolve(['Admin', 'Reporter', 'Driver']) }))
vi.mock('../lib/api/orgInvitations', async (orig) => {
  const real = await orig()
  return { ...real, getInvitationPreview: preview, ...inv }
})

import InviteSignup from '../pages/InviteSignup'
import OrgInvitationsPanel from '../components/admin/OrgInvitationsPanel'
import { LanguageProvider } from '../contexts/LanguageContext'

const TOKEN = 'b'.repeat(64)

function openInvite() {
  render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[`/invite/${TOKEN}`]}>
        <Routes><Route path="/invite/:token" element={<InviteSignup />} /></Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

beforeEach(() => {
  cleanup()
  preview.mockReset(); signUp.mockReset(); signOut.mockClear()
  Object.values(inv).forEach((f) => f.mockReset())
})

describe('invitation sign-up page', () => {
  it('names the company and role from the preview', async () => {
    preview.mockResolvedValue({ ok: true, organisation_name: 'Beta Concrete', company_code: 'BETA', role: 'Driver', email_required: false })
    openInvite()
    expect(await screen.findByText('Join Beta Concrete')).toBeTruthy()
    expect(screen.getByText(/as Driver/)).toBeTruthy()
    expect(screen.getByText(/BETA\/your-username/)).toBeTruthy()
    expect(preview).toHaveBeenCalledWith(TOKEN)
  })

  it('explains an expired link and offers sign in, with no form', async () => {
    preview.mockResolvedValue({ ok: false, reason: 'expired' })
    openInvite()
    expect(await screen.findByText(/has expired/)).toBeTruthy()
    expect(screen.queryByTestId('invite-form')).toBeNull()
  })

  it('a network failure offers Try again instead of calling the link bad', async () => {
    preview.mockResolvedValueOnce({ ok: false, reason: 'error' })
    openInvite()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    preview.mockResolvedValueOnce({ ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false })
    fireEvent.click(retry)
    expect(await screen.findByText('Join Beta')).toBeTruthy()
  })

  it('refuses a short password before calling the server', async () => {
    preview.mockResolvedValue({ ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false })
    openInvite()
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ali.k' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('signs up with the token and shows what to type at sign-in', async () => {
    preview.mockResolvedValue({ ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false })
    signUp.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null })
    openInvite()
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ali.k' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
    await screen.findByTestId('invite-done')
    const arg = signUp.mock.calls[0][0]
    expect(arg.email).toBe('ali.k+beta@users.tyrepulse.app')
    expect(arg.options.data.invite_token).toBe(TOKEN)
    expect(arg.options.data.company_code).toBe('BETA')
    expect(signOut).toHaveBeenCalled() // sign-in happens through the normal page
    expect(screen.getByText('BETA/ali.k')).toBeTruthy()
  })

  it('a taken username says so plainly', async () => {
    preview.mockResolvedValue({ ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false })
    signUp.mockResolvedValue({ data: null, error: { message: 'Database error saving new user' } })
    openInvite()
    await screen.findByTestId('invite-form')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ali.k' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByText(/already taken/)).toBeTruthy()
  })
})

describe('company invitations panel', () => {
  function openPanel(props) {
    render(<LanguageProvider><OrgInvitationsPanel {...props} /></LanguageProvider>)
  }

  it('lists invitations with plain statuses and only offers cancel on waiting ones', async () => {
    inv.listInvitations.mockResolvedValue([
      { id: 'i1', email: null, role: 'Driver', expires_at: '2999-01-01T00:00:00Z' },
      { id: 'i2', email: 'x@beta.com', role: 'Reporter', expires_at: '2999-01-01T00:00:00Z', accepted_at: '2026-11-01' },
    ])
    openPanel()
    expect(await screen.findByText('Anyone with the link')).toBeTruthy()
    expect(screen.getByText('Waiting')).toBeTruthy()
    expect(screen.getByText('Joined')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Cancel invitation/ })).toHaveLength(1)
  })

  it('creates a link and shows it once', async () => {
    inv.listInvitations.mockResolvedValue([])
    inv.createInvitation.mockResolvedValue({ ok: true, invite_token: 'c'.repeat(64) })
    openPanel()
    await screen.findByText('No invitations yet.')
    fireEvent.click(screen.getByRole('button', { name: /Create invitation link/ }))
    const box = await screen.findByTestId('invite-link-ready')
    expect(box.textContent).toMatch(new RegExp(`/invite/${'c'.repeat(64)}`))
    expect(inv.createInvitation).toHaveBeenCalledWith({ email: null, role: 'Reporter', days: 7 })
  })

  it('a failed list read is an error with Retry, never an empty list', async () => {
    inv.listInvitations.mockRejectedValue(new Error('denied'))
    openPanel()
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.queryByText('No invitations yet.')).toBeNull()
  })

  it('a non-Admin sees only an explanation', () => {
    openPanel({ canInvite: false })
    expect(screen.getByText(/Only an Admin/)).toBeTruthy()
    expect(inv.listInvitations).not.toHaveBeenCalled()
  })
})
