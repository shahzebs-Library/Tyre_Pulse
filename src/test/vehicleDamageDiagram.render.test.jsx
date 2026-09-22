import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import VehicleDamageDiagram from '../components/accidents/VehicleDamageDiagram'

// The zones are passed in already labelled, exactly as the panel resolves them
// from ZONE_CATALOGS + ZONE_LABELS, so this exercises the drawing surface only.
const ZONES = [
  { id: 'front_bumper', view: 'front', left: 0.26, top: 0.65, width: 0.48, height: 0.11, label: 'Front bumper' },
  { id: 'front_left_light', view: 'front', left: 0.25, top: 0.51, width: 0.12, height: 0.12, label: 'Left headlight' },
]
const MARKS = new Map([['front_bumper', { number: 1, severity: 'severe', summary: 'Dent · Major · 2 photos' }]])
const IMG = '/vehicle-views/generic_double_cab_five_view_v1_front.png'

function renderDiagram(props = {}) {
  return render(
    <VehicleDamageDiagram
      imageSrc={IMG}
      view="front"
      viewName="Front"
      zones={ZONES}
      marks={MARKS}
      onSelectZone={() => {}}
      {...props}
    />,
  )
}

describe('VehicleDamageDiagram: the vehicle drawing', () => {
  it('draws the view artwork and places every component on it as its own hit target', () => {
    renderDiagram()
    const surface = screen.getByTestId('damage-surface')
    expect(surface).toHaveAttribute('data-surface', 'artwork')
    const img = within(surface).getByRole('img')
    expect(img).toHaveAttribute('src', IMG)
    expect(img).toHaveAttribute('alt', 'Front view of the vehicle')
    expect(within(surface).getAllByRole('button')).toHaveLength(2)
  })

  it('positions a component at its own fraction of the picture, so it scales with the container', () => {
    renderDiagram()
    const zone = screen.getByTestId('zone-front_bumper')
    expect(zone.style.left).toBe('26%')
    expect(zone.style.top).toBe('65%')
    expect(zone.style.width).toBe('48%')
    expect(zone.style.height).toBe('11%')
  })

  it('a marked component carries its number and severity tint; an unmarked one is a quiet target that still says what it is', () => {
    renderDiagram()
    const marked = screen.getByRole('button', { name: '1. Front bumper: Dent · Major · 2 photos' })
    expect(within(marked).getByTestId('marker-1')).toHaveTextContent('1')
    expect(marked.style.borderColor).toBe('rgb(239, 68, 68)') // severe
    const unmarked = screen.getByRole('button', { name: 'Left headlight' })
    expect(within(unmarked).queryByTestId(/marker-/)).toBeNull()
    expect(unmarked).toHaveAttribute('title', 'Left headlight')
    expect(unmarked).toBeEnabled()
  })

  it('clicking a component reports that zone to the caller', () => {
    const onSelectZone = vi.fn()
    renderDiagram({ onSelectZone })
    fireEvent.click(screen.getByRole('button', { name: 'Left headlight' }))
    expect(onSelectZone).toHaveBeenCalledTimes(1)
    expect(onSelectZone.mock.calls[0][0]).toMatchObject({ id: 'front_left_light', label: 'Left headlight' })
  })

  it('marks the selected component so the reader can see which one the sheet is about', () => {
    renderDiagram({ selectedZoneId: 'front_left_light' })
    expect(screen.getByRole('button', { name: 'Left headlight' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^1\. Front bumper/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a viewer who cannot mark can still open an existing mark, but not an empty component', () => {
    renderDiagram({ disabled: true })
    expect(screen.getByRole('button', { name: 'Left headlight' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^1\. Front bumper/ })).toBeEnabled()
  })
})

describe('VehicleDamageDiagram: honest states', () => {
  it('with no approved drawing it says so and still offers every component by name, never another vehicle', () => {
    renderDiagram({ imageSrc: null })
    const surface = screen.getByTestId('damage-surface')
    expect(surface).toHaveAttribute('data-surface', 'no-artwork')
    expect(surface.querySelector('img')).toBeNull()
    expect(within(surface).getByTestId('no-artwork-note')).toHaveTextContent(/No approved drawing for this asset/)
    expect(within(surface).getByRole('button', { name: 'Left headlight' })).toBeEnabled()
    expect(within(surface).getByRole('button', { name: /^1\. Front bumper/ })).toBeInTheDocument()
    expect(within(surface).getByTestId('marker-1')).toHaveTextContent('1')
  })

  it('an image that fails to load falls back the same way instead of leaving an empty frame', () => {
    renderDiagram()
    fireEvent.error(screen.getByRole('img'))
    const surface = screen.getByTestId('damage-surface')
    expect(surface).toHaveAttribute('data-surface', 'no-artwork')
    expect(within(surface).getByRole('button', { name: 'Left headlight' })).toBeEnabled()
  })

  it('a view the asset has no components mapped for says that, rather than drawing nothing', () => {
    renderDiagram({ zones: [] })
    expect(screen.getByTestId('damage-surface')).toHaveTextContent(/No components are mapped for the front view/)
  })
})
