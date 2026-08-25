import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import MultiSelectFilter from '../components/ui/MultiSelectFilter'

/**
 * The control has to ADD to a selection, not replace it.
 *
 * That is the whole difference from the <select> it replaces, and it is exactly
 * the behaviour a reader cannot verify by looking at the code: a control that
 * silently keeps only the last click looks identical on screen until you count
 * the rows. So the second tick is asserted, and so is the fact that clicking an
 * option leaves the panel OPEN - a multi-select that closes after one pick makes
 * choosing three values three round trips.
 */
function Harness({ options, onChange, initial = [] }) {
  const [value, setValue] = useState(initial)
  return (
    <MultiSelectFilter
      label="Region"
      allLabel="All regions"
      pluralLabel="regions"
      options={options}
      value={value}
      onChange={(next) => { setValue(next); onChange?.(next) }}
    />
  )
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /^Region:/ }))

describe('MultiSelectFilter', () => {
  it('accumulates ticks instead of replacing the previous one', () => {
    const onChange = vi.fn()
    render(<Harness options={['CENTRAL', 'WESTERN', 'EASTERN']} onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'CENTRAL' }))
    expect(onChange).toHaveBeenLastCalledWith(['CENTRAL'])
    // The panel stays open, so the second choice is one click and not a reopen.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'WESTERN' }))
    expect(onChange).toHaveBeenLastCalledWith(['CENTRAL', 'WESTERN'])
  })

  it('unticks, and clearing the last one means ALL - never "match nothing"', () => {
    const onChange = vi.fn()
    render(<Harness options={['CENTRAL', 'WESTERN']} onChange={onChange} initial={['CENTRAL']} />)
    open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'CENTRAL' }))
    // An empty array is what filterSelection reads as "not narrowing", so the
    // table fills back up rather than emptying with no way back.
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('reports the selection on the trigger, and in the accessible name', () => {
    render(<Harness options={['CENTRAL', 'WESTERN']} initial={[]} />)
    expect(screen.getByRole('button', { name: 'Region: all' })).toHaveTextContent('All regions')
    open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'CENTRAL' }))
    expect(screen.getByRole('button', { name: 'Region: CENTRAL' })).toHaveTextContent('CENTRAL')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'WESTERN' }))
    // Two values is a count, not a truncated list that hides one of them.
    expect(screen.getByRole('button', { name: 'Region: CENTRAL, WESTERN' })).toHaveTextContent('2 regions')
  })

  it('marks each option checked so a screen reader can read the state', () => {
    render(<Harness options={['CENTRAL', 'WESTERN']} initial={['WESTERN']} />)
    open()
    expect(screen.getByRole('menuitemcheckbox', { name: 'CENTRAL' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemcheckbox', { name: 'WESTERN' })).toHaveAttribute('aria-checked', 'true')
  })

  it('Clear drops every pick in one gesture', () => {
    const onChange = vi.fn()
    render(<Harness options={['A', 'B']} onChange={onChange} initial={['A', 'B']} />)
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('disables itself when there is nothing to choose between', () => {
    // A dropdown that can only ever return nothing is worse than no dropdown.
    render(<Harness options={[]} />)
    expect(screen.getByRole('button', { name: /^Region:/ })).toBeDisabled()
  })

  it('counts only picks that are still on offer', () => {
    // A region left ticked from another country must not claim to be narrowing
    // something the reader cannot see on screen.
    render(<Harness options={['CENTRAL']} initial={['CENTRAL', 'GONE']} />)
    expect(screen.getByRole('button', { name: /^Region:/ })).toHaveTextContent('CENTRAL')
  })
})
