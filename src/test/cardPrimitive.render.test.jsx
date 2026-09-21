import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import Card, { CardHeader, CardBody, CardFooter, CardGrid } from '../components/ui/Card'

/**
 * Pins the two properties the Card primitive exists to guarantee, because both
 * are invisible in review and silently regress:
 *
 *  1. It must NOT clip its own children by default. The legacy `.card` class
 *     sets overflow:hidden, which is the documented cause of the clipped
 *     popover / clipped modal bugs that index.css carries specificity hacks for.
 *  2. Its padding must come from the density-aware token, never a literal, so
 *     switching data-density retightens every card at once.
 */
describe('Card primitive', () => {
  it('does not clip its children unless clipping is asked for', () => {
    const { container, rerender } = render(<Card>body</Card>)
    const card = container.querySelector('.tp-card')
    expect(card).toBeTruthy()
    // The whole point: a menu/popover rendered inside must be able to escape.
    expect(card.className).not.toMatch(/overflow-hidden/)

    rerender(<Card clip>body</Card>)
    expect(container.querySelector('.tp-card').className).toMatch(/overflow-hidden/)
  })

  it('takes padding from the density token, not a hardcoded value', () => {
    const { container } = render(<Card>body</Card>)
    expect(container.querySelector('.tp-card').style.padding).toBe('var(--pad-card)')
  })

  it('uses the tight token for pad="tight" and no padding for pad="none"', () => {
    const { container, rerender } = render(<Card pad="tight">x</Card>)
    expect(container.querySelector('.tp-card').style.padding).toBe('var(--pad-card-tight)')
    rerender(<Card pad="none">x</Card>)
    expect(container.querySelector('.tp-card').style.padding).toBe('0px')
  })

  it('only advertises interactivity when the whole card really is clickable', () => {
    const { container, rerender } = render(<Card>plain</Card>)
    expect(container.querySelector('.tp-card').className).not.toMatch(/tp-card--interactive/)
    rerender(<Card interactive>clickable</Card>)
    expect(container.querySelector('.tp-card').className).toMatch(/tp-card--interactive/)
  })

  it('renders a REAL heading element so the page outline stays sequential', () => {
    render(
      <Card>
        <CardHeader title="Open work orders" level={2} description="Last 30 days" />
      </Card>,
    )
    const h = screen.getByRole('heading', { name: 'Open work orders', level: 2 })
    expect(h.tagName).toBe('H2')
    expect(screen.getByText('Last 30 days')).toBeTruthy()
  })

  it('clamps a nonsense heading level into the valid h1-h6 range', () => {
    render(<Card><CardHeader title="Clamped" level={99} /></Card>)
    expect(screen.getByRole('heading', { name: 'Clamped', level: 6 }).tagName).toBe('H6')
  })

  it('renders header actions and does not reserve space when there are none', () => {
    const { container, rerender } = render(<Card><CardHeader title="T" actions={<button>Export</button>} /></Card>)
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()

    // With no title and no description the header must not push the body down.
    rerender(<Card><CardHeader /></Card>)
    expect(container.querySelector('.tp-card > div').style.marginBottom).toBe('0px')
  })

  it('composes body and footer', () => {
    render(
      <Card>
        <CardBody grow>rows</CardBody>
        <CardFooter><button>Save</button></CardFooter>
      </Card>,
    )
    expect(screen.getByText('rows')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('CardGrid uses the shared gap token so two sections cannot disagree', () => {
    const { container } = render(<CardGrid><Card>a</Card><Card>b</Card></CardGrid>)
    const grid = container.firstChild
    expect(grid.style.gap).toBe('var(--gap-grid)')
    expect(grid.style.gridTemplateColumns).toMatch(/minmax\(min\(260px, 100%\), 1fr\)/)
  })

  it('never lets a card collapse below its min width on a narrow viewport', () => {
    // min(X, 100%) is what stops a grid forcing horizontal page scroll.
    const { container } = render(<CardGrid min="420px"><Card>a</Card></CardGrid>)
    expect(container.firstChild.style.gridTemplateColumns).toContain('min(420px, 100%)')
  })

  it('tints only the border for a tone, never the whole surface', () => {
    const { container } = render(<Card tone="crit">alert</Card>)
    const el = container.querySelector('.tp-card')
    expect(el.style.borderColor).toContain('#f26161')
    // A wall of tiles must stay scannable: the fill stays neutral.
    expect(el.style.background).toBe('var(--card-from)')
  })
})
