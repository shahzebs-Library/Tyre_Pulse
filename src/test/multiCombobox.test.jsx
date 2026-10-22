import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import MultiCombobox from '../components/ui/MultiCombobox'

const OPTIONS = [
  { value: 'Driver', label: 'Driver', hint: '4 people' },
  { value: 'Tyre Man', label: 'Tyre Man', hint: '17 people' },
  { value: 'Tire Planning Engineer', label: 'Tire Planning Engineer' },
  { value: 'Inspector', label: 'Inspector' },
]

function Harness({ options = OPTIONS, initial = [], onChange, label = 'Job role' }) {
  const [value, setValue] = useState(initial)
  return (
    <form onSubmit={(e) => { e.preventDefault(); onChange?.('SUBMITTED') }}>
      <MultiCombobox label={label} pluralLabel="job roles" allLabel="All job roles"
        options={options} value={value}
        onChange={(v) => { setValue(v); onChange?.(v) }} />
      <button type="button">after</button>
    </form>
  )
}

const input = () => screen.getByRole('combobox', { name: 'Job role' })
const key = (k, extra = {}) => fireEvent.keyDown(input(), { key: k, ...extra })

describe('MultiCombobox ARIA', () => {
  it('is a labelled combobox that controls a multi-selectable listbox', () => {
    render(<Harness />)
    const box = input()
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).toHaveAttribute('aria-autocomplete', 'list')
    expect(box).toHaveAttribute('aria-haspopup', 'listbox')
    fireEvent.focus(box)
    expect(box).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Job role' })
    expect(box).toHaveAttribute('aria-controls', list.id)
    expect(list).toHaveAttribute('aria-multiselectable', 'true')
    const opts = within(list).getAllByRole('option')
    expect(opts).toHaveLength(4)
    expect(opts[0]).toHaveAttribute('aria-setsize', '4')
    expect(opts[0]).toHaveAttribute('aria-posinset', '1')
    expect(opts.every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true)
  })

  it('points aria-activedescendant at the highlighted option while focus stays on the input', () => {
    render(<Harness />)
    fireEvent.focus(input())
    const opts = screen.getAllByRole('option')
    expect(input()).toHaveAttribute('aria-activedescendant', opts[0].id)
    key('ArrowDown')
    expect(input()).toHaveAttribute('aria-activedescendant', opts[1].id)
    expect(opts[1]).toBeInTheDocument()
  })

  it('describes the state to screen readers: count, hint and removable chips', () => {
    render(<Harness initial={['Driver', 'Inspector']} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 selected')
    expect(screen.getByRole('list', { name: 'Selected job roles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Driver' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select all 4 matching job roles' })).toBeInTheDocument()
  })

  it('states that no selection means no filter', () => {
    render(<Harness />)
    expect(screen.getByRole('status')).toHaveTextContent('All job roles (no filter)')
  })
})

describe('MultiCombobox keyboard', () => {
  it('ArrowDown opens, arrows move with wrap, Enter toggles, list stays open for more picks', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key('ArrowDown')
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    key('Enter')
    expect(onChange).toHaveBeenLastCalledWith(['Driver'])
    key('ArrowDown')
    key('Enter')
    expect(onChange).toHaveBeenLastCalledWith(['Driver', 'Tyre Man'])
    expect(input()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    key('ArrowUp'); key('ArrowUp')
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[3].id)
    key('Enter')
    expect(onChange).toHaveBeenLastCalledWith(['Driver', 'Tyre Man', 'Inspector'])
  })

  it('Enter never submits the surrounding form', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key('ArrowDown')
    key('Enter')
    expect(onChange).not.toHaveBeenCalledWith('SUBMITTED')
  })

  it('Home and End jump to the first and last option', () => {
    render(<Harness />)
    key('ArrowDown')
    key('End')
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[3].id)
    key('Home')
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id)
  })

  it('Space toggles while the search is empty', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    key('ArrowDown')
    key(' ')
    expect(onChange).toHaveBeenLastCalledWith(['Driver'])
  })

  it('typing filters (type-ahead) and highlights the first match', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(input(), { target: { value: 'tyre' } })
    const opts = screen.getAllByRole('option')
    expect(opts).toHaveLength(1)
    expect(opts[0]).toHaveTextContent('Tyre Man')
    expect(input()).toHaveAttribute('aria-activedescendant', opts[0].id)
    key('Enter')
    expect(onChange).toHaveBeenLastCalledWith(['Tyre Man'])
  })

  it('Home/End keep the text caret while a search is typed', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 't' } })
    const before = input().getAttribute('aria-activedescendant')
    key('End')
    expect(input().getAttribute('aria-activedescendant')).toBe(before)
  })

  it('Escape closes the list and keeps focus on the input; a second Escape clears the search', () => {
    render(<Harness />)
    input().focus()
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: 'dri' } })
    key('Escape')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(input())
    key('Escape')
    expect(input()).toHaveValue('')
  })

  it('Tab closes the list so focus can move on', () => {
    render(<Harness />)
    key('ArrowDown')
    key('Tab')
    expect(input()).toHaveAttribute('aria-expanded', 'false')
  })

  it('announces an empty result', () => {
    render(<Harness />)
    fireEvent.change(input(), { target: { value: 'zzzz' } })
    expect(screen.getByText('No matching job roles.')).toBeInTheDocument()
    expect(input()).not.toHaveAttribute('aria-activedescendant')
  })
})

describe('MultiCombobox selection controls', () => {
  it('select all matching applies to the filtered set only, then Clear returns to ALL (empty array)', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(input(), { target: { value: 'ti' } })
    const matches = screen.getAllByRole('option').map((o) => o.textContent)
    fireEvent.click(screen.getByRole('button', { name: /^Select all \d+ matching job roles$/ }))
    const last = onChange.mock.calls.at(-1)[0]
    expect(last).toHaveLength(matches.length)
    expect(last).not.toContain('Driver')
    fireEvent.click(screen.getByRole('button', { name: 'Clear job roles' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('removes one chip with its named button', () => {
    const onChange = vi.fn()
    render(<Harness initial={['Driver', 'Tyre Man']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Driver' }))
    expect(onChange).toHaveBeenLastCalledWith(['Tyre Man'])
  })

  it('clicking an option toggles it without losing input focus', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    input().focus()
    fireEvent.focus(input())
    const opt = screen.getAllByRole('option')[1]
    expect(fireEvent.mouseDown(opt)).toBe(false) // default prevented, so focus stays
    fireEvent.click(opt)
    expect(onChange).toHaveBeenLastCalledWith(['Tyre Man'])
    expect(document.activeElement).toBe(input())
  })

  it('matches extra hidden search text and Arabic variants', () => {
    const options = [{ value: '9', label: 'Abdullah (E-102)', search: 'عَبْدُ الله abdullah E-102' }]
    render(<Harness options={options} label="Job role" />)
    fireEvent.change(input(), { target: { value: 'عبد الله' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.change(input(), { target: { value: 'e-102' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('collapses many chips behind a "+N more" toggle', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `P${i}`, label: `Person ${i}` }))
    render(
      <MultiCombobox label="People" options={many} value={many.map((o) => o.value)} onChange={() => {}} chipLimit={3} />,
    )
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '+9 more' }))
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(12)
  })

  it('outside press closes the list', () => {
    render(<Harness />)
    fireEvent.focus(input())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
