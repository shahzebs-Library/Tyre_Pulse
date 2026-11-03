import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../components/inspection/AiTyreProgress', () => ({ default: () => null }))
vi.mock('../components/inspection/InspectionPhotos', () => ({ default: () => null }))
vi.mock('../components/inspection/InspectionDiagram', () => ({ default: () => null }))

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
  it('opens the observations board over the same rows instead of a blank screen', () => {
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
    expect(onView).toHaveBeenCalledWith(ROUTINE)
    fireEvent.click(screen.getByRole('button', { name: /^Inspections\s*Conduct/i }))
    expect(screen.queryByRole('table', { name: 'Observations' })).toBeNull()
  })
})
