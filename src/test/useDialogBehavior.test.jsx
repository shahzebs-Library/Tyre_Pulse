import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

import useDialogBehavior from '../components/ui/useDialogBehavior'

/**
 * Regression cover for a bug that made dialogs untypeable.
 *
 * `onClose` used to be in the effect's dependency array. Almost every caller
 * passes an inline arrow, so the identity changed on every parent render; the
 * effect's CLEANUP restores focus to whatever opened the dialog and the re-run
 * then focuses the panel. For any dialog whose form state lives in the PAGE,
 * that meant one keystroke -> parent re-render -> focus ripped out of the field.
 *
 * These tests pin BOTH halves of the fix, because either alone is wrong:
 *   - the effect must NOT re-run when only `onClose` changes identity, and
 *   - Escape must still invoke the LATEST `onClose`, not a captured stale one.
 */
function Harness({ open, onClose, extra }) {
  const panelRef = useRef(null)
  useDialogBehavior(open, panelRef, onClose)
  return (
    <div>
      <button type="button" data-testid="trigger">open</button>
      {open && (
        <div ref={panelRef} tabIndex={-1} data-testid="panel">
          <input data-testid="field" defaultValue="" />
          <span>{extra}</span>
        </div>
      )}
    </div>
  )
}

describe('useDialogBehavior', () => {
  it('does not steal focus when the parent re-renders with a new inline onClose', () => {
    const { rerender } = render(<Harness open onClose={() => {}} extra="a" />)
    const field = screen.getByTestId('field')

    act(() => field.focus())
    expect(document.activeElement).toBe(field)

    // Exactly what a page-level onChange does: new render, new arrow function.
    for (const ch of ['b', 'c', 'd']) {
      rerender(<Harness open onClose={() => {}} extra={ch} />)
    }

    // If `onClose` were back in the deps this would be the trigger or the panel.
    expect(document.activeElement).toBe(field)
  })

  it('still calls the LATEST onClose on Escape, never a stale captured one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Harness open onClose={first} extra="1" />)

    rerender(<Harness open onClose={second} extra="2" />)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('focuses the panel once on open, not the first control', () => {
    // Landing on a destructive button by default is how people delete things.
    render(<Harness open onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByTestId('panel'))
  })

  it('locks page scroll while open and restores it exactly on close', () => {
    document.body.style.overflow = 'auto'
    const { rerender } = render(<Harness open onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('hidden')

    rerender(<Harness open={false} onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('returns focus to the opener when the dialog closes', () => {
    const { rerender } = render(<Harness open={false} onClose={() => {}} />)
    const trigger = screen.getByTestId('trigger')
    act(() => trigger.focus())

    rerender(<Harness open onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByTestId('panel'))

    rerender(<Harness open={false} onClose={() => {}} />)
    expect(document.activeElement).toBe(trigger)
  })

  it('does nothing at all while closed', () => {
    const onClose = vi.fn()
    document.body.style.overflow = 'visible'
    render(<Harness open={false} onClose={onClose} />)
    expect(document.body.style.overflow).toBe('visible')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
