import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import en from '../locales/en/shell.json'
const h = vi.hoisted(() => ({ save: vi.fn(), profile: { id: 'self', full_name: 'Shahzeb Rahman', avatar_url: 'https://example.com/me.jpg' } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: h.profile }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: key => key.split('.').slice(1).reduce((v, p) => v?.[p], en) || key }) }))
vi.mock('../lib/api/profileAvatar', () => ({ saveMyAvatar: (...args) => h.save(...args) }))
import AvatarEditor from '../components/shell/AvatarEditor'
import ProfileAvatar from '../components/shell/ProfileAvatar'
const image = 'data:image/jpeg;base64,/9j/AA=='
beforeEach(() => {
  h.save.mockReset().mockResolvedValue(image)
  const context = Object.fromEntries(['fillRect', 'drawImage', 'beginPath', 'ellipse', 'fill', 'arc', 'stroke', 'fillText'].map(key => [key, vi.fn()]))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(image)
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1200, height: 1600, close: vi.fn() }))
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:preview'), revokeObjectURL: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('account picture editor', () => {
  it('creates a local avatar and saves it for the current identity only after Save', async () => {
    const close = vi.fn(); render(<AvatarEditor open onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Avatar', exact: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save picture' })).not.toBeDisabled())
    expect(h.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Female', exact: true }))
    expect(screen.getByRole('button', { name: 'Female', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Male', exact: true })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(image, 'self'))
    expect(close).toHaveBeenCalled()
  })
  it('crops an uploaded photo and exposes zoom/framing before saving', async () => {
    render(<AvatarEditor open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Photo', { selector: 'input' }), { target: { files: [new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save picture' })).not.toBeDisabled())
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Vertical position' })).toBeInTheDocument()
    expect(h.save).not.toHaveBeenCalled()
  })
  it('rejects an invalid upload without enabling save', () => {
    render(<AvatarEditor open onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Photo', { selector: 'input' }), { target: { files: [new File(['svg'], 'photo.svg', { type: 'image/svg+xml' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPG')
    expect(screen.getByRole('button', { name: 'Save picture' })).toBeDisabled()
  })
  it('keeps the editor open on a save failure and allows removal', async () => {
    const close = vi.fn(); h.save.mockRejectedValueOnce(new Error('network'))
    render(<AvatarEditor open onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'))
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(h.save).toHaveBeenCalledWith(null, 'self')
  })
  it('updates all current-user avatar instances without changing another account', () => {
    const { container } = render(<><ProfileAvatar profile={h.profile} /><ProfileAvatar profile={{ id: 'other', full_name: 'Other User' }} /></>)
    fireEvent(window, new CustomEvent('tp-profile-avatar', { detail: { id: 'self', value: image } }))
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('img')).toHaveAttribute('src', image)
    expect(container.textContent).toContain('OU')
    fireEvent(window, new CustomEvent('tp-profile-avatar', { detail: { id: 'self', value: null } }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('SR')
  })
})
