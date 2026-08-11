import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import Modal from '../components/ui/Modal'

afterEach(cleanup)

/**
 * These pin the two halves of the screen-fit fix: the shared shell's behaviour,
 * and the global CSS net that reaches the dialogs still hand rolled per page.
 * The CSS assertions read the stylesheet as text because jsdom does not apply
 * media queries, and a silently deleted rule would put every one of those
 * dialogs back in a small fixed box.
 */

const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8')

describe('Modal shell', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">body</Modal>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sizes from the viewport rather than a fixed box', () => {
    render(<Modal open onClose={() => {}} title="Life targets" size="lg">body</Modal>)
    const panel = screen.getByRole('dialog')
    expect(panel.className).toContain('tp-dialog-panel')
    expect(panel.className).toContain('tp-dialog-panel--lg')
  })

  it('scrolls the body, not the whole dialog, so header and actions stay put', () => {
    render(
      <Modal open onClose={() => {}} title="T" footer={<button>Save</button>}>
        <p>content</p>
      </Modal>
    )
    const panel = screen.getByRole('dialog')
    expect(panel.querySelector('.tp-dialog-body')).toBeTruthy()
    expect(panel.querySelector('.tp-dialog-head')).toBeTruthy()
    expect(panel.querySelector('.tp-dialog-foot')).toBeTruthy()
  })

  it('closes on Escape and on a backdrop click, but not on a click inside', () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose} title="T"><p>inside</p></Modal>)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(screen.getByText('inside'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(document.querySelector('.tp-dialog-overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('locks the page behind it and releases the lock on close', () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="T">body</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Modal open={false} onClose={() => {}} title="T">body</Modal>)
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('is announced as a dialog and labelled by its title', () => {
    render(<Modal open onClose={() => {}} title="Tyre life targets">body</Modal>)
    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(panel.getAttribute('aria-labelledby')).textContent)
      .toBe('Tyre life targets')
  })
})

describe('global dialog fit net', () => {
  it('caps an uncapped centred dialog at the viewport instead of letting it overflow', () => {
    expect(css).toContain(':where(.fixed.inset-0.flex.items-center.justify-center) > *')
    expect(css).toMatch(/max-height:\s*92dvh/)
  })

  it('keeps the fallback at zero specificity so a panel can still state its own intent', () => {
    // A plain selector here would override every hand rolled max-height in the
    // app, which is the opposite of a safety net.
    const net = css.slice(css.indexOf(':where(.fixed.inset-0.flex.items-center.justify-center)'))
    expect(net.startsWith(':where(')).toBe(true)
  })

  it('widens each dialog size bucket on large displays', () => {
    for (const bucket of ['max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-3xl']) {
      expect(css).toContain(`.fixed.inset-0.flex.items-center.justify-center > .${bucket}`)
    }
    expect(css).toContain('@media (min-width: 1920px)')
  })

  it('lets a card panelled dialog scroll, since .card would otherwise clip it', () => {
    // Deliberately not a :where() rule: it has to outrank .card overflow:hidden.
    expect(css).toContain('.fixed.inset-0.flex.items-center.justify-center > .card')
  })

  it('leaves side drawers full height and only widens them', () => {
    expect(css).toContain('.fixed.inset-0 > .tp-drawer-panel')
  })

  it('gives portalled popovers a bounded height so a long menu never runs off screen', () => {
    expect(css).toContain('.tp-popover')
    expect(css).toMatch(/\.tp-popover\s*\{[^}]*position:\s*fixed/)
  })
})
