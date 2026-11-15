import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const preview = vi.hoisted(() => vi.fn())
const signUp = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
const inv = vi.hoisted(() => ({
  listInvitations: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(),
  getMyOrgSignInCode: vi.fn(), setMyOrgSignInCode: vi.fn(),
}))
// The new account's own profile row, read right after sign-up (undefined = not readable).
const own = vi.hoisted(() => ({ row: undefined }))
const from = vi.hoisted(() => vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: own.row, error: null }) }) }),
})))

vi.mock('../lib/supabase', () => ({ supabase: { auth: { signUp, signOut }, rpc: vi.fn(), from } }))
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
  inv.getMyOrgSignInCode.mockResolvedValue(null)
  own.row = undefined
})

const OK_PREVIEW = { ok: true, organisation_name: 'Beta', company_code: 'BETA', role: 'Driver', email_required: false }

async function fillAndSubmit({ email } = {}) {
  await screen.findByTestId('invite-form')
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ali.k' } })
  if (email) fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } })
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'longenough1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create my account' }))
}

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
    signUp.mockResolvedValue({ data: { session: { access_token: 'x' }, user: { id: 'u1' } }, error: null })
    own.row = { org_id: 'beta-org', approved: true }
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

  it('an account that landed outside the company is NOT reported as joined (server dropped the invitation)', async () => {
    // Production before TEN-9e keeps the account but drops a cancelled invitation:
    // GoTrue says success, the person's own row is hidden (no company), the link still reads ok.
    preview.mockResolvedValue(OK_PREVIEW)
    signUp.mockResolvedValue({ data: { session: { access_token: 'x' }, user: { id: 'u1' } }, error: null })
    openInvite()
    await fillAndSubmit()
    expect(await screen.findByText(/could not be applied/)).toBeTruthy()
    expect(screen.queryByTestId('invite-done')).toBeNull()
    expect(signOut).toHaveBeenCalled()
  })

  it('no session (email confirmation): a link that now reads used counts as joined', async () => {
    preview.mockResolvedValueOnce(OK_PREVIEW).mockResolvedValueOnce({ ok: false, reason: 'used' })
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null })
    openInvite()
    await fillAndSubmit()
    expect(await screen.findByTestId('invite-done')).toBeTruthy()
  })

  it('a refused sign-up whose link was cancelled meanwhile shows the cancelled-link screen', async () => {
    preview.mockResolvedValueOnce(OK_PREVIEW).mockResolvedValueOnce({ ok: false, reason: 'revoked' })
    signUp.mockResolvedValue({ data: null, error: { message: 'Database error saving new user' } })
    openInvite()
    await fillAndSubmit()
    expect(await screen.findByTestId('invite-invalid')).toBeTruthy()
  })

  it('an email-bound invitation refused while the link is still good names both likely causes', async () => {
    preview.mockResolvedValue({ ...OK_PREVIEW, email_required: true })
    signUp.mockResolvedValue({ data: null, error: { message: 'Database error saving new user' } })
    openInvite()
    await fillAndSubmit({ email: 'someone@example.com' })
    expect(await screen.findByText(/different email address/)).toBeTruthy()
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

  it('shows the company code and why it cannot be changed here', async () => {
    inv.listInvitations.mockResolvedValue([])
    inv.getMyOrgSignInCode.mockResolvedValue({ code: 'BETA', slug: 'beta', effectiveCode: 'BETA', canSet: false, reason: 'already_set' })
    openPanel()
    expect((await screen.findByTestId('org-code-current')).textContent).toMatch('BETA/their-username')
    expect(screen.getByTestId('org-code-reason').textContent).toMatch(/platform team/)
    expect(screen.queryByRole('button', { name: 'Save code' })).toBeNull()
  })

  it('a company Admin chooses the code once multi-company mode allows it', async () => {
    inv.listInvitations.mockResolvedValue([])
    inv.getMyOrgSignInCode
      .mockResolvedValueOnce({ code: null, slug: 'beta-haulage', effectiveCode: 'beta-haulage', canSet: true, reason: null })
      .mockResolvedValueOnce({ code: 'BETA', slug: 'beta-haulage', effectiveCode: 'BETA', canSet: false, reason: 'already_set' })
    inv.setMyOrgSignInCode.mockResolvedValue('BETA')
    openPanel()
    const input = await screen.findByLabelText(/Choose the code/)
    fireEvent.change(input, { target: { value: '-bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save code' }))
    expect(await screen.findByText(/2 to 24 letters/, { selector: '[role="alert"]' })).toBeTruthy()
    expect(inv.setMyOrgSignInCode).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'BETA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save code' }))
    expect(await screen.findByText('Company code saved.')).toBeTruthy()
    expect(inv.setMyOrgSignInCode).toHaveBeenCalledWith('BETA')
  })

  it('no code block when the server function is not there yet', async () => {
    inv.listInvitations.mockResolvedValue([])
    openPanel()
    await screen.findByText('No invitations yet.')
    expect(screen.queryByTestId('org-code-block')).toBeNull()
  })

  it('a non-Admin sees only an explanation', () => {
    openPanel({ canInvite: false })
    expect(screen.getByText(/Only an Admin/)).toBeTruthy()
    expect(inv.listInvitations).not.toHaveBeenCalled()
  })
})
