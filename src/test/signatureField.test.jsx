import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  getMySignature: vi.fn(),
  saveMySignature: vi.fn(),
  clearMySignature: vi.fn(),
}))

vi.mock('../lib/api/userSignature', () => h)
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, lang: 'en' }),
}))

const { default: SignatureField } = await import('../components/checklist/SignatureField')

const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L9 9"/></svg>'

/** Draw one stroke on the pad. jsdom reports a zero-sized box, which is fine. */
function drawOnPad() {
  const pad = screen.getByTestId('signature-capture')
  fireEvent.mouseDown(pad, { clientX: 5, clientY: 5 })
  fireEvent.mouseMove(pad, { clientX: 20, clientY: 12 })
  fireEvent.mouseUp(pad, { clientX: 20, clientY: 12 })
}

beforeEach(() => {
  h.getMySignature.mockReset()
  h.saveMySignature.mockReset().mockImplementation((v) => Promise.resolve(v))
  h.clearMySignature.mockReset()
})

describe('SignatureField - the saved signature', () => {
  it('loads the person own saved mark, SHOWS it, and hands it to the parent', async () => {
    h.getMySignature.mockResolvedValue(SVG_A)
    const onChange = vi.fn()
    render(<SignatureField onChange={onChange} />)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(SVG_A))
    // Visible, not silent: a mark that is attached without being shown is
    // indistinguishable from the app signing on someone's behalf.
    expect(screen.getByText('signature.field.savedInUse')).toBeInTheDocument()
    expect(screen.getByAltText(/signature/i)).toBeInTheDocument()
  })

  it('pre-filling writes NOTHING - it never re-saves the signature it just read', async () => {
    h.getMySignature.mockResolvedValue(SVG_A)
    render(<SignatureField onChange={() => {}} />)
    await screen.findByText('signature.field.savedInUse')
    expect(h.saveMySignature).not.toHaveBeenCalled()
    expect(h.clearMySignature).not.toHaveBeenCalled()
  })

  it('a person with no saved mark gets a blank pad and can still sign normally', async () => {
    h.getMySignature.mockResolvedValue(null)
    const onChange = vi.fn()
    render(<SignatureField onChange={onChange} />)

    const pad = await screen.findByTestId('signature-capture')
    expect(pad).toBeInTheDocument()
    // Nothing was attached before they drew anything.
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('<svg'))

    drawOnPad()
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(typeof last === 'string' && last.startsWith('<svg')).toBe(true)
    })
  })

  it('remembers the FIRST mark a person draws, because that is what was asked for', async () => {
    h.getMySignature.mockResolvedValue(null)
    render(<SignatureField onChange={() => {}} />)
    await screen.findByTestId('signature-capture')
    drawOnPad()
    await waitFor(() => expect(h.saveMySignature).toHaveBeenCalledTimes(1))
    expect(h.saveMySignature.mock.calls[0][0]).toContain('<svg')
  })

  it('a one-off redraw does NOT silently replace a mark the person already chose', async () => {
    h.getMySignature.mockResolvedValue(SVG_A)
    const onChange = vi.fn()
    render(<SignatureField onChange={onChange} />)
    await screen.findByText('signature.field.savedInUse')

    fireEvent.click(screen.getByText('signature.field.drawNew'))
    // Switching to the pad detaches the saved mark - nothing is in play until
    // they actually draw.
    expect(onChange).toHaveBeenLastCalledWith(null)

    drawOnPad()
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(typeof last === 'string' && last.startsWith('<svg')).toBe(true)
    })
    // The remember box starts UNTICKED for someone who already has one.
    expect(h.saveMySignature).not.toHaveBeenCalled()
  })

  it('ticking "remember this" while redrawing DOES replace the saved mark', async () => {
    h.getMySignature.mockResolvedValue(SVG_A)
    render(<SignatureField onChange={() => {}} />)
    await screen.findByText('signature.field.savedInUse')
    fireEvent.click(screen.getByText('signature.field.drawNew'))
    fireEvent.click(screen.getByRole('checkbox'))
    drawOnPad()
    await waitFor(() => expect(h.saveMySignature).toHaveBeenCalledTimes(1))
  })

  it('a failed save leaves the drawn mark attached and says so', async () => {
    h.getMySignature.mockResolvedValue(null)
    h.saveMySignature.mockRejectedValue(new Error(''))
    const onChange = vi.fn()
    render(<SignatureField onChange={onChange} />)
    await screen.findByTestId('signature-capture')
    drawOnPad()
    await screen.findByText('signature.field.saveFailed')
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(typeof last === 'string' && last.startsWith('<svg')).toBe(true)
  })

  it('a signature that cannot be loaded leaves a usable blank pad, never a broken screen', async () => {
    // getMySignature already degrades to null; this pins that the field then
    // behaves exactly like a first-time signer rather than rendering nothing.
    h.getMySignature.mockResolvedValue(null)
    render(<SignatureField onChange={() => {}} />)
    expect(await screen.findByTestId('signature-capture')).toBeInTheDocument()
  })
})
