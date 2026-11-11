import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import EnterpriseTable from '../components/ui/EnterpriseTable'

/**
 * F-J-01: a sortable column header must be operable from the keyboard.
 *
 * The sort used to be a click handler on the <th>, which a keyboard user can
 * neither focus nor fire. It is now an inner native <button> (aria-sort stays on
 * the th), which is what makes it keyboard-operable: a <button> sits in the
 * sequential focus order and Enter/Space activate it natively. This is a real
 * render, because focusability and activation are what a source scan cannot see.
 *
 * (The brief names @testing-library/user-event for Tab/Enter. This repo does not
 * ship a resolvable @testing-library/dom for user-event, and no test here uses
 * it, so the same three facts are proven with fireEvent + focus, matching every
 * other render test in src/test: the control is a native button, it is in the
 * tab order and focusable, and activating it - what Enter does on a button -
 * flips aria-sort.)
 */

const columns = [
  { accessorKey: 'name', header: 'Asset' },
  { accessorKey: 'site', header: 'Site' },
]
const data = [
  { name: 'TM671', site: 'QIDDIYA' },
  { name: 'MP093', site: 'NHC' },
]

function renderTable() {
  return render(
    <EnterpriseTable
      columns={columns}
      data={data}
      enableGlobalFilter={false}
      enableColumnFilters={false}
      enableColumnVisibility={false}
      enableExport={false}
      showPagination={false}
    />,
  )
}

afterEach(cleanup)

describe('EnterpriseTable sortable header is keyboard operable', () => {
  it('renders the sort control as a real button carrying the column name', () => {
    renderTable()
    const sortButtons = screen.getAllByRole('button', { name: /Asset/ })
    expect(sortButtons.length).toBeGreaterThanOrEqual(1)
    expect(sortButtons[0].tagName).toBe('BUTTON')
  })

  it('the sort button is in the tab order and focusable (the <th> onClick never was)', () => {
    renderTable()
    const sortButton = screen.getAllByRole('button', { name: /Asset/ })[0]
    // A native <button> with no tabindex="-1" is in the sequential focus order,
    // i.e. reachable by Tab. The old <th onClick> had no focus behaviour at all.
    expect(sortButton.getAttribute('tabindex')).not.toBe('-1')
    sortButton.focus()
    expect(document.activeElement).toBe(sortButton)
  })

  it('activating the button flips aria-sort on the header', () => {
    renderTable()
    const sortButton = screen.getAllByRole('button', { name: /Asset/ })[0]
    const header = screen.getByRole('columnheader', { name: /Asset/ })
    // Unsorted to start: the header makes no sort claim.
    expect(header.getAttribute('aria-sort')).toBeNull()

    // A click is exactly what Enter/Space do on a native button.
    fireEvent.click(sortButton)
    expect(header.getAttribute('aria-sort')).toBe('ascending')

    fireEvent.click(sortButton)
    expect(header.getAttribute('aria-sort')).toBe('descending')
  })
})
