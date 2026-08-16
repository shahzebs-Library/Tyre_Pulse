import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import useAnchoredPopover from '../components/ui/useAnchoredPopover'

/**
 * Focus must come back to the trigger when a popover closes.
 *
 * Every menu in the shell (create, profile, help, reporting scope, working
 * location) portals its panel to the body, so on close the focused element is
 * removed from the document and focus falls to <body>. A keyboard user is then
 * dumped at the top of the page. This is the one place that can fix it for all
 * five, which is why the behaviour is pinned on the hook and not on a component.
 */
function Harness({ onOpenChange }) {
  const [open, setOpen] = useState(false)
  const { triggerRef } = useAnchoredPopover(open, { width: 200, height: 200 })
  return (
    <div>
      <button ref={triggerRef} onClick={() => { setOpen(true); onOpenChange?.(true) }}>
        Open menu
      </button>
      <button onClick={() => setOpen(false)}>Close from outside</button>
      {open && (
        <div role="menu">
          <button onClick={() => setOpen(false)}>Item</button>
        </div>
      )}
    </div>
  )
}

const openMenu = () => {
  const trigger = screen.getByText('Open menu')
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('anchored popover focus return', () => {
  it('returns focus to the trigger when focus was orphaned', () => {
    render(<Harness />)
    const trigger = openMenu()

    // Focus an item, then close it the way a menu item does: the panel unmounts
    // underneath the focused element, so focus lands on <body>.
    const item = screen.getByText('Item')
    item.focus()
    expect(document.activeElement).toBe(item)

    act(() => { fireEvent.click(item) })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('does NOT steal focus from something the user moved to', () => {
    render(<Harness />)
    openMenu()

    // Closing by interacting with another control: that control legitimately
    // holds focus and must keep it.
    const other = screen.getByText('Close from outside')
    other.focus()
    act(() => { fireEvent.click(other) })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(other)
  })

  it('does nothing on first render, when the popover was never open', () => {
    // Guards against the hook grabbing focus on mount and yanking the page to
    // the top bar the moment any screen loads.
    render(
      <div>
        <input aria-label="Search" autoFocus />
        <Harness />
      </div>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Search'))
  })
})
