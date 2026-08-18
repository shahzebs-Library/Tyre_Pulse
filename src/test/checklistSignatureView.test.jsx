import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SignatureView, { signatureSrc } from '../components/checklist/SignatureView'
import SignatureCapture, { buildSvg } from '../components/checklist/SignatureCapture'

afterEach(() => cleanup())

/**
 * The two stacks capture a signature in two formats and one of them could not be
 * displayed at all, which is the same thing on screen as never having signed.
 */
describe('signatureSrc', () => {
  it('renders the phone format - raw SVG markup is not a URL', () => {
    // This is the bug. `<img src="<svg …>">` shows a broken image, and nearly
    // every signature in this fleet is drawn on a phone.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L2 2"/></svg>'
    const src = signatureSrc(svg)
    expect(src.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(src)).toContain('<path')
  })

  it('keeps the web format untouched', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(signatureSrc(png)).toBe(png)
  })

  it('refuses anything that is not an image', () => {
    // A signature column holding a script URL must render nothing, not run.
    expect(signatureSrc('javascript:alert(1)')).toBeNull()
    expect(signatureSrc('data:text/html,<script>x</script>')).toBeNull()
  })

  it('treats absent, blank and non-string as unsigned', () => {
    expect(signatureSrc(null)).toBeNull()
    expect(signatureSrc('   ')).toBeNull()
    expect(signatureSrc(42)).toBeNull()
  })
})

describe('SignatureView', () => {
  it('says a line is unsigned rather than dropping it - a missing sign-off is the finding', () => {
    render(<SignatureView value={null} label="Supervisor" name="A. Khan" />)
    expect(screen.getByText('Not signed')).toBeInTheDocument()
    expect(screen.getByText('A. Khan')).toBeInTheDocument()
  })

  it('says the name was not recorded rather than showing an unattributed signature', () => {
    render(<SignatureView value="<svg/>" label="Mechanic" name={null} />)
    expect(screen.getByText('Name not recorded')).toBeInTheDocument()
  })

  it('opens the signature so it can actually be looked at', () => {
    render(<SignatureView value="<svg/>" label="Supervisor" name="A. Khan" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByTitle('Open this signature'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('SignatureCapture', () => {
  it('emits the same SVG shape the phone writes, so one column holds one format', () => {
    const svg = buildSvg([[{ x: 1, y: 2 }, { x: 8, y: 9 }]], 300, 120)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('<path d="M1.0 2.0 L8.0 9.0"')
  })

  it('reports nothing drawn as null, never as an empty signature', () => {
    // An empty <svg/> stored in the column would read as a signature that was
    // given. It was not.
    const onChange = vi.fn()
    render(<SignatureCapture onChange={onChange} />)
    const pad = screen.getByTestId('signature-capture')
    fireEvent.mouseDown(pad, { clientX: 5, clientY: 6 })
    fireEvent.mouseUp(pad, { clientX: 5, clientY: 6 })
    fireEvent.click(screen.getByText('Clear'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('hands the drawing up when the stroke ends', () => {
    const onChange = vi.fn()
    render(<SignatureCapture onChange={onChange} />)
    const pad = screen.getByTestId('signature-capture')
    fireEvent.mouseDown(pad, { clientX: 5, clientY: 6 })
    fireEvent.mouseMove(pad, { clientX: 40, clientY: 30 })
    fireEvent.mouseUp(pad, { clientX: 40, clientY: 30 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toContain('<path')
  })
})
