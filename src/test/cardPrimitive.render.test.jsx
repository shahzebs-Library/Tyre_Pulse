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
    // The tone reaches the border THROUGH a custom property - see the hover
    // regression test below for why it must not be a resolved borderColor.
    expect(el.style.getPropertyValue('--tp-card-tone')).toContain('#f26161')
    expect(el.style.border).toBe('1px solid var(--tp-card-border)')
    // A wall of tiles must stay scannable: the fill stays neutral.
    expect(el.style.background).toBe('var(--card-from)')
  })

  it('lets a semantic header icon keep its colour, defaulting to muted', () => {
    // TWO migrations refused CardHeader rather than lose an amber Trophy or a
    // green Wallet. A kit that costs you meaning on the pages whose icons carry
    // meaning is the worse choice, so it loses - that is why iconTone exists.
    const Dot = (props) => <svg {...props} data-testid="ic" />
    const muted = render(<CardHeader title="Plain" icon={Dot} />)
    expect(muted.getByTestId('ic').style.color).toBe('var(--text-muted)')

    const warn = render(<CardHeader title="League" icon={Dot} iconTone="warn" />)
    expect(warn.getAllByTestId('ic').at(-1).style.color).toBe('rgb(245, 165, 36)')

    // An unknown tone must fall back, never render an invalid colour.
    const junk = render(<CardHeader title="Odd" icon={Dot} iconTone="banana" />)
    expect(junk.getAllByTestId('ic').at(-1).style.color).toBe('var(--text-muted)')
  })

  it('CardBody forwards a ref, so a capture target can live on it', () => {
    // BoardOverview's PDF export walks chartRefs.current[key]
    // .querySelector('canvas'). When CardBody swallowed the ref the target had
    // to sit on a hand-rolled inner div, and moving it onto CardBody later
    // would have broken the export SILENTLY - page fine, PDF charts gone.
    const ref = { current: null }
    render(
      <Card>
        <CardBody ref={ref} style={{ height: '16rem' }}>
          <canvas data-testid="cv" />
        </CardBody>
      </Card>,
    )
    expect(ref.current).toBeInstanceOf(HTMLElement)
    expect(ref.current.querySelector('canvas')).not.toBeNull()
    // The definite height must survive too: chart.js sizes from its parent.
    expect(ref.current.style.height).toBe('16rem')
  })

  describe('the hover cue must survive (regression)', () => {
    /**
     * Card sets `border` and `box-shadow` inline so stray `border-*` utilities
     * stay inert and `tone` remains the single route. But an inline declaration
     * also beats `.tp-card--interactive:hover`, so writing the tone straight
     * into `borderColor` silently killed the hover cue on EVERY interactive
     * card. The tell was that `cursor` and the focus ring still worked - the two
     * properties Card never sets inline.
     *
     * jsdom does not apply the stylesheet, so this pins the MECHANISM: the two
     * properties must resolve through variables the stylesheet owns.
     */
    it('does not pin border-color or box-shadow to a resolved value inline', () => {
      const { container } = render(<Card interactive tone="good">x</Card>)
      const el = container.querySelector('.tp-card')
      // If either of these becomes a literal colour/shadow again, :hover dies.
      expect(el.style.border).toBe('1px solid var(--tp-card-border)')
      expect(el.style.boxShadow).toBe('var(--tp-card-shadow)')
      expect(el.style.borderColor).toBe('')
    })

    it('writes the tone to its OWN variable, not the one hover re-points', () => {
      // Collapsing the two names puts the tone back inline and the cue dies.
      const { container } = render(<Card tone="warn">x</Card>)
      const el = container.querySelector('.tp-card')
      expect(el.style.getPropertyValue('--tp-card-tone')).not.toBe('')
      expect(el.style.getPropertyValue('--tp-card-border')).toBe('')
      expect(el.style.getPropertyValue('--tp-card-shadow')).toBe('')
    })

    it('leaves text colour to the stylesheet so a text-* class can win', () => {
      // `color` was inline, which killed every text colour class on a Card.
      // Unlike pad/tone there is no API reason for it to be inline.
      const { container } = render(<Card className="text-red-300">x</Card>)
      expect(container.querySelector('.tp-card').style.color).toBe('')
    })
  })
})
