import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HandoverDamageMarker from '../components/handover/HandoverDamageMarker'
import { newMarker } from '../lib/vehicleHandoverMarks'

const stem = 'transit_mixer_3axle_five_view_v1'

describe('HandoverDamageMarker', () => {
  it('drops a marker where the picture is clicked', () => {
    const onChange = vi.fn()
    render(<HandoverDamageMarker stem={stem} views={['front', 'left']} marks={[]} onChange={onChange} />)
    const surface = screen.getByTestId('handover-damage-surface')
    expect(surface.dataset.surface).toBe('artwork')
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 })
    fireEvent.click(surface, { clientX: 50, clientY: 100 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0]).toMatchObject({ view: 'front', x: 25, y: 50 })
  })

  it('shows markers read-only and an honest outline without artwork', () => {
    const marks = [newMarker({ view: 'left', x: 10, y: 10 })]
    render(<HandoverDamageMarker stem={null} views={['front', 'left']} marks={marks} />)
    expect(screen.getByTestId('handover-damage-surface').dataset.surface).toBe('no-artwork')
    expect(screen.getByTestId('handover-marker-1')).toBeTruthy()
    expect(screen.queryByText('Add marker at centre')).toBeNull()
  })
})
