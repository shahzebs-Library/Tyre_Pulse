import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'

// The tyre map draws the real top-down photo (same set as the Flutter app)
// where one exists, and keeps the drawn body where no true top view exists.
const photoOf = (type) => {
  const { container, unmount } = render(<VehicleTyreDiagram vehicleType={type} width={200} />)
  const href = container.querySelector('svg[data-tyre-map] image')?.getAttribute('href') || null
  unmount()
  return href
}

describe('tyre map body photo', () => {
  it('uses the real top-down photo for mixers, pumps, loaders, pickups and buses', () => {
    expect(photoOf('TR-MIXER')).toBe('/tyre-map-photos/tri-mixer.webp')
    expect(photoOf('PUMPS')).toBe('/tyre-map-photos/concrete-pump.webp')
    expect(photoOf('LINE PUMP')).toBe('/tyre-map-photos/line-pump.webp')
    expect(photoOf('WHEEL_LOADER')).toBe('/tyre-map-photos/wheel-loader.webp')
    expect(photoOf('SKID LOADER')).toBe('/tyre-map-photos/skid-loader.webp')
    expect(photoOf('PICKUP')).toBe('/tyre-map-photos/pickup.webp')
  })

  it('keeps the drawn body where no true top view exists', () => {
    expect(photoOf('CANTER')).toBeNull()
  })
})
