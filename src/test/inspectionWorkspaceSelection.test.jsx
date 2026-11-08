import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../components/inspection/AiTyreProgress', () => ({ default: () => null }))
vi.mock('../components/inspection/InspectionPhotos', () => ({ default: () => null, usePhotoItems: () => ({ refs: [], items: [] }), PhotoLightbox: () => null }))
vi.mock('../components/inspection/InspectionDiagram', () => ({ default: () => null }))
vi.mock('../lib/api/tyreChangeTracking', () => ({ listFitmentsForAssets: vi.fn(async () => ({ ok: true, rows: [] })) }))

import InspectionWorkspace from '../components/inspections/InspectionWorkspace'

// Today's inspection of TM514, an older one of TM514 that the "Today" tab
// hides, and another vehicle that IS in the Today list.
const TODAY = '2026-11-08'
const NEW514 = { id: 'n514', inspection_type: 'Routine', status: 'Scheduled', asset_no: 'TM514', site: 'NHC', inspection_date: TODAY, created_at: `${TODAY}T09:00:00Z`, tyre_conditions: { LHF1: { condition: 'Puncture' } } }
const OTHER = { id: 'o600', inspection_type: 'Routine', status: 'Scheduled', asset_no: 'TM600', site: 'JED', inspection_date: TODAY, created_at: `${TODAY}T10:00:00Z`, tyre_conditions: { LHF1: { condition: 'Good' } } }
const OLD514 = { id: 'old514', inspection_type: 'Routine', status: 'Done', asset_no: 'TM514', site: 'NHC', inspection_date: '2026-10-01', tyre_conditions: { LHF1: { condition: 'Worn' } } }

function renderWs(props = {}) {
  const rows = [NEW514, OTHER, OLD514]
  return render(
    <MemoryRouter>
      <InspectionWorkspace rows={rows} allRows={rows} loading={false} error={null} onRetry={() => {}}
        flagMap={{}} sites={[]} onFilter={() => {}} onView={() => {}} onPdf={() => {}}
        onRaiseAction={props.onRaiseAction || (() => {})} onEdit={() => {}} now={new Date(`${TODAY}T12:00:00`)} />
    </MemoryRouter>,
  )
}

const queueRow = (asset) => screen.getAllByRole('button', { name: new RegExp(asset) }).find((b) => b.hasAttribute('aria-pressed') && b.className.includes('iw-row'))
const headerAsset = () => document.querySelector('.iw-dhead-title h2')?.textContent

describe('Inspection workspace keeps the vehicle you opened', () => {
  it('History opens that vehicle, even when it is outside the current list', () => {
    renderWs()
    fireEvent.click(screen.getByRole('tab', { name: /Today/ }))
    fireEvent.click(queueRow('TM514'))
    expect(headerAsset()).toBe('TM514')
    fireEvent.click(screen.getByRole('tab', { name: /History/ }))
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    // Before the fix this fell back to the first Today row: TM600.
    expect(headerAsset()).toBe('TM514')
    expect(screen.getByText(/older inspection of TM514/)).toBeTruthy()
  })

  it('Create action raises for the vehicle on screen', () => {
    const onRaiseAction = vi.fn()
    renderWs({ onRaiseAction })
    fireEvent.click(queueRow('TM514'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Create action' })[0])
    expect(onRaiseAction).toHaveBeenCalledWith(expect.objectContaining({ asset_no: 'TM514' }))
    expect(headerAsset()).toBe('TM514')
  })
})
