import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { positionsFromConfig, normalizeDiagramConfig } from '../lib/vehicleDiagram'

const layout = positionsFromConfig(normalizeDiagramConfig({ body: 'mixer', axles: [{ kind: 'steer' }, { kind: 'drive', dual: true }] }))
vi.mock('../lib/api/vehicleDiagrams', () => ({
  getCustomLayoutMap: () => Promise.resolve({ 'TEST RIG': { ...layout, label: 'Test rig' } }),
  canonVehicleTypeKey: (v) => String(v || '').trim().toUpperCase(),
}))

import VehicleTyreDiagram from '../components/VehicleTyreDiagram'

describe('board and thumbnail keep a Vehicle Designer body', () => {
  it('draws the designed body in the card board', async () => {
    const { container } = render(<VehicleTyreDiagram vehicleType="Test rig" variant="board" width={340} />)
    await waitFor(() => expect(container.querySelector('.tb-title b')?.textContent).toBe('Test rig'))
    const art = container.querySelector('.tb-photo svg')
    expect(art).toBeTruthy()
    expect(art.childElementCount).toBeGreaterThan(1)
  })
  it('draws the designed body in the photo thumbnail', async () => {
    const { container } = render(<VehicleTyreDiagram vehicleType="Test rig" variant="photo" width={150} />)
    await waitFor(() => expect(container.querySelector('.tb-thumb small')?.textContent).toMatch(/Test rig/))
    expect(container.querySelector('.tb-thumb svg')).toBeTruthy()
  })
})
