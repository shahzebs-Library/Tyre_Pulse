import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const status = vi.fn()
const clear = vi.fn()
vi.mock('../lib/api/adminAccess', () => ({
  adminLoginLockStatus: (...a) => status(...a),
  adminClearLoginLock: (...a) => clear(...a),
}))

import LoginLockPanel from '../console/pages/users/LoginLockPanel'

describe('LoginLockPanel (TEN-9f admin recovery)', () => {
  beforeEach(() => { status.mockReset(); clear.mockReset() })

  it('renders nothing before the migration is installed', async () => {
    status.mockResolvedValue(null)
    const { container } = render(<LoginLockPanel userId="u1" />)
    await waitFor(() => expect(status).toHaveBeenCalledWith('u1'))
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the account is not locked', async () => {
    status.mockResolvedValue({ ok: true, locked: false, failed_attempts: 2 })
    const { container } = render(<LoginLockPanel userId="u1" />)
    await waitFor(() => expect(status).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('requires a reason and clears a locked account', async () => {
    status.mockResolvedValue({ ok: true, locked: true, failed_attempts: 5, retry_after_seconds: 600 })
    clear.mockResolvedValue({ ok: true, cleared: 1 })
    const onCleared = vi.fn()
    render(<LoginLockPanel userId="u1" onCleared={onCleared} />)
    const btn = await screen.findByRole('button', { name: /clear lockout now/i })
    expect(screen.getByText(/after 5 failed attempts/i)).toBeTruthy()
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/confirmed by phone/i), { target: { value: 'Phoned the user' } })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await screen.findByText(/lockout cleared/i)
    expect(clear).toHaveBeenCalledWith('u1', 'Phoned the user')
    expect(onCleared).toHaveBeenCalled()
  })

  it('shows a plain refusal for another company', async () => {
    status.mockResolvedValue({ ok: true, locked: true, failed_attempts: 5, retry_after_seconds: 60 })
    clear.mockResolvedValue({ ok: false, reason: 'forbidden' })
    render(<LoginLockPanel userId="u1" />)
    fireEvent.change(await screen.findByPlaceholderText(/confirmed by phone/i), { target: { value: 'some reason' } })
    fireEvent.click(screen.getByRole('button', { name: /clear lockout now/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/own company/i)
  })
})
