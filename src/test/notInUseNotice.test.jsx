import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotInUseNotice from '../components/ui/NotInUseNotice'

/**
 * The honesty rule this component exists to enforce: a module with no rows must
 * SAY it has no rows, so its zeros are not read as measurements. Equally, an
 * unknown count must say nothing at all - "we could not look" and "there is
 * nothing" are opposite statements, and only one of them is safe to assert.
 */
describe('NotInUseNotice', () => {
  it('states the module is empty when the count is zero', () => {
    render(<NotInUseNotice count={0} label="purchase orders" />)
    expect(screen.getByText(/No purchase orders have been recorded yet/i)).toBeTruthy()
    // and explains WHY every figure reads zero
    expect(screen.getByText(/because nothing has been entered/i)).toBeTruthy()
  })

  it('renders nothing once the module is genuinely in use', () => {
    const { container } = render(<NotInUseNotice count={1} label="suppliers" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the count is unknown - never claims emptiness', () => {
    for (const v of [null, undefined, NaN, 'x']) {
      const { container } = render(<NotInUseNotice count={v} label="claims" />)
      expect(container.firstChild).toBeNull()
    }
  })

  it('includes the hint when given', () => {
    render(<NotInUseNotice count={0} label="retread claims" hint="Claims appear once one is raised." />)
    expect(screen.getByText(/Claims appear once one is raised/i)).toBeTruthy()
  })
})
