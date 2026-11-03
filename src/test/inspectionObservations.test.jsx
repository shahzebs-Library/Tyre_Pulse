import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../components/inspection/AiTyreProgress', () => ({ default: () => null }))
vi.mock('../components/inspection/InspectionPhotos', () => ({ default: () => null }))
vi.mock('../components/inspection/InspectionDiagram', () => ({ default: () => null }))
vi.mock('../lib/api/tyreChangeTracking', () => ({ listFitmentsForAssets: vi.fn(async () => ({ ok: true, rows: [] })) }))

import {
  observationRegister, filterObservations, observationSummary,
} from '../lib/inspectionWorkspaceView'
import InspectionWorkspace from '../components/inspections/InspectionWorkspace'

const ROUTINE = {
  id: 'i1', inspection_type: 'Routine', status: 'Done', asset_no: 'TM514', site: 'NHC',
  inspector: 'Ali', inspection_date: '2026-11-01',
  tyre_conditions: { LHF1: { condition: 'Puncture' }, RHF1: { condition: 'Good' }, LHR1: { condition: 'Worn' } },
  findings: '1 tyre damage', notes: '1 tyre damage\nOdometer: 102118 km',
}
const CLEAN = {
  id: 'i2', inspection_type: 'Routine', status: 'Done', asset_no: 'TM600', site: 'JED',
  inspection_date: '2026-10-30', tyre_conditions: { LHF1: { condition: 'Good' } }, notes: 'Odometer: 5 km',
}
const OBS = {
  id: 'o1', inspection_type: 'Site Observation', status: 'Scheduled', site: 'NHC',
  title: 'Loose cable', severity: 'High', inspection_date: '2026-10-29', tyre_conditions: null,
}

describe('observationRegister', () => {
  const list = observationRegister([CLEAN, ROUTINE, OBS])

  it('lists non-Good tyres, the written remark once, and site observations', () => {
    expect(list.map((o) => o.kind)).toEqual(['tyre', 'tyre', 'note', 'observation'])
    expect(list.find((o) => o.kind === 'note').text).toBe('1 tyre damage')
  })

  it('drops the meter lines the app writes into notes', () => {
    expect(list.some((o) => o.inspectionId === 'i2')).toBe(false)
  })

  it('bands a puncture as Critical and wear as Minor', () => {
    const tyres = list.filter((o) => o.kind === 'tyre')
    expect(tyres.map((o) => o.severity).sort()).toEqual(['Critical', 'Minor'])
  })

  it('summarises and filters', () => {
    const s = observationSummary(list)
    expect(s).toMatchObject({ total: 4, tyre: 2, note: 1, observation: 1, critical: 2, vehicles: 1 })
    expect(filterObservations(list, { kind: 'tyre' })).toHaveLength(2)
    expect(filterObservations(list, { q: 'cable' })).toHaveLength(1)
    expect(filterObservations(list, { severity: 'Critical' })).toHaveLength(1)
  })
})

describe('Observations module', () => {
  it('opens the observations board over the same rows instead of a blank screen', async () => {
    const onView = vi.fn()
    render(
      <MemoryRouter>
        <InspectionWorkspace rows={[ROUTINE, CLEAN]} allRows={[ROUTINE, CLEAN]} sites={[]} flagMap={{}}
          onFilter={() => {}} onView={onView} onRaiseAction={() => {}} onEdit={() => {}} onPdf={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Observations\s*All findings/i }))
    const table = screen.getByRole('table', { name: 'Observations' })
    expect(within(table).getByText('Puncture')).toBeInTheDocument()
    expect(within(table).getByText('1 tyre damage')).toBeInTheDocument()
    fireEvent.click(within(table).getAllByRole('button', { name: /Open/ })[0])
    // Open shows that ONE finding first, with the way into the full sheet.
    expect(await screen.findByText('Is it fixed?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open full inspection/ }))
    expect(onView).toHaveBeenCalledWith(ROUTINE)
    fireEvent.click(screen.getByRole('button', { name: /^Inspections\s*Conduct/i }))
    expect(screen.queryByRole('table', { name: 'Observations' })).toBeNull()
  })
})

import { withTyreNow, tyreNowSummary, matchesTyreNow } from '../lib/observationTracking'

describe('has the observed tyre been replaced', () => {
  const insp = {
    id: 'r1', inspection_type: 'Routine', status: 'Done', asset_no: 'MP119', site: 'NHC', country: 'KSA',
    inspection_date: '2026-10-01', vehicle_type: 'PUMPS',
    tyre_conditions: { LHF1: { condition: 'Puncture' }, RHF1: { condition: 'Worn' }, LHF2: { condition: 'Damaged' } },
  }
  const fit = (position, serial, issue_date, extra = {}) => ({ asset_no: 'MP119', country: 'KSA', position, serial_no: serial, issue_date, ...extra })
  const fitments = [
    fit('LHF1', 'OLD1', '2025-01-01'), fit('LHF1', 'NEW1', '2026-10-05', { job_card: 'GCKR/JC/1022/1026' }), // replaced after the inspection
    fit('RHF1', 'OLD2', '2025-02-01'), // still fitted
  ]
  const list = withTyreNow(observationRegister([insp]), fitments, { now: new Date('2026-11-03') })
  const by = (p) => list.find((o) => o.rawPosition === p)

  it('marks a wheel with a newer tyre fitted after the inspection as replaced', () => {
    expect(by('LHF1').tyreNow.state).toBe('replaced')
    expect(by('LHF1').tyreNow.replacement).toMatchObject({ serial: 'NEW1', fittedOn: '2026-10-05' })
    expect(by('LHF1').tyreNow.daysToReplace).toBe(4)
    // The job card the change was booked on, from the tyre consumption upload.
    expect(by('LHF1').tyreNow.replacement.jobCard).toBe('GCKR/JC/1022/1026')
  })

  it('keeps the same tyre as still fitted, and a wheel with no record as not known', () => {
    expect(by('RHF1').tyreNow.state).toBe('on_vehicle')
    expect(by('LHF2').tyreNow.state).toBe('unknown')
  })

  it('counts open as still fitted plus not known, and filters by it', () => {
    expect(tyreNowSummary(list)).toMatchObject({ replaced: 1, on_vehicle: 1, unknown: 1, open: 2 })
    expect(list.filter((o) => matchesTyreNow(o, 'open'))).toHaveLength(2)
    // The default view hides only what the history shows was already replaced.
    expect(list.filter((o) => matchesTyreNow(o, 'not_replaced')).map((o) => o.rawPosition).sort()).toEqual(['LHF2', 'RHF1'])
  })

  it('gives no status at all while the records are not loaded', () => {
    expect(withTyreNow(observationRegister([insp]), null).some((o) => o.tyreNow)).toBe(false)
  })
})

import { observationLabel, observationOptions } from '../lib/inspectionWorkspaceView'
describe('observation filter values', () => {
  it('folds conditions to one label and counts them, most frequent first', () => {
    const list = [
      { kind: 'tyre', text: 'WORN' }, { kind: 'tyre', text: 'Worn' }, { kind: 'tyre', text: 'Puncture' },
      { kind: 'note', text: 'All tire good' },
    ]
    expect(observationLabel(list[0])).toBe('Worn')
    expect(observationLabel(list[3])).toBe('Inspector note')
    expect(observationOptions(list)).toEqual([
      { label: 'Worn', count: 2 }, { label: 'Inspector note', count: 1 }, { label: 'Puncture', count: 1 },
    ])
  })

  it('search reaches the replacement serial and job card', () => {
    const o = { kind: 'tyre', text: 'Worn', tyreNow: { state: 'replaced', replacement: { serial: 'YMA55312', jobCard: 'GCKR/JC/1022/1026' }, previous: { serial: 'OLD9' } } }
    expect(filterObservations([o], { q: 'jc/1022' })).toHaveLength(1)
    expect(filterObservations([o], { q: 'old9' })).toHaveLength(1)
    expect(filterObservations([o], { q: 'nothing' })).toHaveLength(0)
  })
})
