// Investment / stocking-strategy scenario screen over the tested simulation engine
// (docs/inventory/22_SIMULATION_METHOD.md worked example).
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StrategyScenarioPanel, { readScenarioField, buildScenarioParams, invalidScenarioFields } from '../components/inventory/StrategyScenarioPanel'
import { LanguageProvider } from '../contexts/LanguageContext'

const ui = () => render(<LanguageProvider><StrategyScenarioPanel defaultCurrency="SAR" /></LanguageProvider>)
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('strategy scenario inputs', () => {
  it('blank is missing, percent becomes a share, junk is ignored', () => {
    expect(readScenarioField('', 'qty')).toBeUndefined()
    expect(readScenarioField('12', 'pct')).toBe(0.12)
    expect(readScenarioField('1,000', 'money')).toBe(1000)
    expect(readScenarioField('abc', 'qty')).toBeUndefined()
    expect(buildScenarioParams([['a', 'qty'], ['b', 'pct']], { a: '5', b: '' })).toEqual({ a: 5 })
  })

  it('years must be a whole number of 1 or more', () => {
    expect(readScenarioField('3', 'years')).toBe(3)
    expect(readScenarioField('0', 'years')).toBeUndefined()
    expect(readScenarioField('1.5', 'years')).toBeUndefined()
    expect(invalidScenarioFields([['commitmentYears', 'years'], ['x', 'qty']], { commitmentYears: '1.5', x: '' })).toEqual(['commitmentYears'])
  })
})

describe('StrategyScenarioPanel', () => {
  it('names the missing inputs instead of inventing defaults', async () => {
    ui()
    const note = await screen.findByText(/Enter the required inputs/)
    expect(note.textContent).toMatch(/Annual demand \(units\)/)
  })

  it('reproduces the pinned SAR 15M bulk vs supplier-managed example, labelled as a scenario', async () => {
    ui()
    await screen.findByLabelText('Annual demand (units)')
    type('Annual demand (units)', '5000')
    type('Unit price', '1000')
    type('Obsolescence per year (%)', '2')
    type('Lead time (days)', '30')
    type('Bulk quantity', '15000')
    type('Service premium (%)', '3')
    type('Minimum commitment value', '1000000')
    type('Commitment (years)', '3')
    expect(screen.getByText('SAR 18,232,480.00')).toBeTruthy()
    expect(screen.getByText('SAR 15,450,000.00')).toBeTruthy()
    expect(screen.getByText('SAR 2,782,480.00')).toBeTruthy()
    expect(screen.getByText('SAR 7,334,666.67')).toBeTruthy()
    expect(screen.getByText(/not an actual saving/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/you saved/i)
  })

  it('a zero or fractional commitment term shows an input error instead of crashing', async () => {
    ui()
    await screen.findByLabelText('Annual demand (units)')
    type('Annual demand (units)', '5000')
    type('Unit price', '1000')
    type('Lead time (days)', '30')
    type('Bulk quantity', '15000')
    type('Service premium (%)', '3')
    type('Minimum commitment value', '99000000')
    for (const bad of ['0', '1.5']) {
      type('Commitment (years)', bad)
      expect(screen.getByText(/Fix these inputs/).textContent).toMatch(/Commitment \(years\)/)
    }
    type('Commitment (years)', '3')
    expect(screen.queryByText(/Fix these inputs/)).toBeNull()
  })
})
