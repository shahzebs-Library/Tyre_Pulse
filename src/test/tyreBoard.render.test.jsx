import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TyreBoard from '../components/inspection/TyreBoard'

const tyres = [
  { id: 'FL', x: 20, y: 40, w: 20, h: 40 },
  { id: 'FR', x: 160, y: 40, w: 20, h: 40 },
  { id: 'RL', x: 20, y: 220, w: 20, h: 40 },
  { id: 'RR', x: 160, y: 220, w: 20, h: 40 },
]

describe('TyreBoard', () => {
  it('shows one card per wheel with only what was recorded', () => {
    const { container } = render(
      <TyreBoard
        tyres={tyres}
        viewH={320}
        photo={{ href: '/tyre-map-photos/pickup.webp', fit: 'meet' }}
        tyreData={{
          FL: { risk: 'Good', condition: 'Good', pressure: 110, tread: 12.5 },
          FR: { risk: 'Damage', condition: 'Damaged', pressure: null, tread: null },
          RL: { risk: 'Wear', condition: 'Worn', pressure: 95, tread: null },
        }}
        riskOf={(id) => ({ FL: 'good', FR: 'critical', RL: 'warning' })[id] || 'none'}
        codeOf={(id) => ({ FL: 'LHF', FR: 'RHF', RL: 'LHR', RR: 'RHR' })[id]}
        title="Pickup"
      />,
    )
    expect(container.querySelectorAll('.tb-card')).toHaveLength(4)
    expect(screen.getByText('LHF')).toBeTruthy()
    expect(screen.getByText('12.5')).toBeTruthy()
    expect(screen.getByText('Damaged')).toBeTruthy()
    expect(screen.getByText('Worn')).toBeTruthy()
    // RR has no reading at all
    expect(screen.getByText('Not recorded', { selector: '.tb-muted' })).toBeTruthy()
    expect(screen.getByText(/4 tyres, 3 recorded/)).toBeTruthy()
    // No drawn tyre or rim graphics: the photo plus cards only.
    expect(container.querySelector('rect')).toBeNull()
    expect(container.querySelector('img').getAttribute('src')).toBe('/tyre-map-photos/pickup.webp')
  })
})
