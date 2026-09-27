import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import SideDrawer, { resolveEdge } from '../components/ui/SideDrawer'
import Modal from '../components/ui/Modal'

/**
 * SideDrawer is Modal's full-height sibling for record rails. These pin the
 * behaviour the hand-rolled rails were each missing some of: focus trap,
 * Escape, the busy lock, the logical (RTL aware) side, and that a dialog
 * opened on top of a drawer is the only one that answers the keyboard.
 */

// jsdom does no layout, so offsetParent is always null and the focus trap
// would see zero focusable controls. Give every element a parent for the trap.
let offsetDescriptor
beforeAll(() => {
  offsetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.parentNode },
  })
})
afterAll(() => {
  if (offsetDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetDescriptor)
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('dir')
})

const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8').replace(/\r\n/g, '\n')

function Drawer(props) {
  return (
    <SideDrawer open onClose={() => {}} title="WO-1" footer={<button type="button">Save</button>} {...props}>
      <button type="button">First action</button>
      <input aria-label="Note" />
    </SideDrawer>
  )
}

describe('SideDrawer shell', () => {
  it('renders nothing when closed', () => {
    render(<SideDrawer open={false} onClose={() => {}} title="Hidden">body</SideDrawer>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a labelled modal dialog portalled to the body on the drawer contract', () => {
    const { container } = render(<Drawer />)
    const panel = screen.getByRole('dialog')
    expect(container.contains(panel)).toBe(false)
    expect(panel.parentElement.parentElement).toBe(document.body)
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(panel.getAttribute('aria-labelledby')).textContent).toBe('WO-1')
    expect(panel.className).toContain('tp-drawer-panel')
    expect(panel.parentElement.className).toContain('tp-drawer-overlay')
    expect(panel.querySelector('.tp-drawer-body')).toBeTruthy()
    expect(panel.querySelector('.tp-drawer-head')).toBeTruthy()
    expect(panel.querySelector('.tp-drawer-foot')).toBeTruthy()
  })

  it('moves focus into the panel, locks the page, and returns focus on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { rerender } = render(<Drawer />)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Drawer open={false} />)
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('traps Tab inside the panel in both directions', () => {
    render(<Drawer closeLabel="Close drawer" />)
    const close = screen.getByRole('button', { name: 'Close drawer' })
    const save = screen.getByRole('button', { name: 'Save' })

    save.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    close.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)
  })

  it('closes on Escape, the backdrop and the close button, but not a click inside', () => {
    const onClose = vi.fn()
    render(<Drawer onClose={onClose} closeLabel="Close drawer" />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(screen.getByRole('button', { name: 'First action' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(document.querySelector('.tp-drawer-overlay'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('refuses every dismissal path while busy', () => {
    const onClose = vi.fn()
    render(<Drawer onClose={onClose} busy closeLabel="Close drawer" />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.tp-drawer-overlay'))
    const close = screen.getByRole('button', { name: 'Close drawer' })
    expect(close.disabled).toBe(true)
    fireEvent.click(close)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true')
  })

  it('does not close on the backdrop when closeOnBackdrop is false', () => {
    const onClose = vi.fn()
    render(<Drawer onClose={onClose} closeOnBackdrop={false} />)
    fireEvent.mouseDown(document.querySelector('.tp-drawer-overlay'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('SideDrawer side is logical, so it follows the reading direction', () => {
  it('resolves the physical edge from the document direction', () => {
    expect(resolveEdge('end', 'ltr')).toBe('right')
    expect(resolveEdge('end', 'rtl')).toBe('left')
    expect(resolveEdge('start', 'ltr')).toBe('left')
    expect(resolveEdge('start', 'rtl')).toBe('right')
  })

  it('opens on the right in English and on the left in Arabic', () => {
    render(<Drawer />)
    expect(document.querySelector('.tp-drawer-overlay').getAttribute('data-edge')).toBe('right')
    cleanup()

    document.documentElement.setAttribute('dir', 'rtl')
    render(<Drawer />)
    const overlay = document.querySelector('.tp-drawer-overlay')
    expect(overlay.getAttribute('data-edge')).toBe('left')
    expect(overlay.className).toContain('tp-drawer-overlay--end')
  })

  it('pins the start variant to the opposite edge', () => {
    render(<Drawer side="start" />)
    const overlay = document.querySelector('.tp-drawer-overlay')
    expect(overlay.className).toContain('tp-drawer-overlay--start')
    expect(overlay.getAttribute('data-edge')).toBe('left')
  })

  it('uses logical CSS, so the rail and its border flip with the direction', () => {
    expect(css).toMatch(/\.tp-drawer-overlay\s*\{[^}]*justify-content:\s*flex-end/)
    expect(css).toMatch(/\.tp-drawer-shell\s*\{[^}]*border-inline-start:/)
    expect(css).toContain('.tp-drawer-overlay[data-edge="left"] > .tp-drawer-shell')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tp-drawer-shell\s*\{\s*animation:\s*none/)
  })
})

describe('a dialog stacked on a drawer', () => {
  it('only the topmost answers Escape, then the drawer takes it back', () => {
    const closeDrawer = vi.fn()
    const closeModal = vi.fn()
    const { rerender } = render(
      <>
        <SideDrawer open onClose={closeDrawer} title="Request">rail</SideDrawer>
        <Modal open onClose={closeModal} title="Reject">reason</Modal>
      </>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeModal).toHaveBeenCalledTimes(1)
    expect(closeDrawer).not.toHaveBeenCalled()

    rerender(
      <>
        <SideDrawer open onClose={closeDrawer} title="Request">rail</SideDrawer>
        <Modal open={false} onClose={closeModal} title="Reject">reason</Modal>
      </>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeDrawer).toHaveBeenCalledTimes(1)
    expect(closeModal).toHaveBeenCalledTimes(1)
  })
})
