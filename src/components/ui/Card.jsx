/**
 * Card — the surface primitive for the enterprise shell.
 *
 * WHY THIS EXISTS. An audit of `src/pages` counted 1,712 hand-rolled
 * `className="card ..."` divs across 255 pages. Because every page invented its
 * own padding, heading size and action row, density and hierarchy drifted page
 * to page — which is what reads as "not enterprise grade", far more than colour
 * choice does.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE LEGACY `.card` CLASS:
 *
 * 1. NO `overflow: hidden`. `.card` sets it to clip its accent hairline, and
 *    that single declaration is the documented cause of the clipped-popover and
 *    clipped-modal bugs — `index.css` carries two separate specificity hacks to
 *    work around it. A card must never clip a menu, popover or date picker that
 *    legitimately renders inside it. Pass `clip` only when the content really is
 *    an image or chart that must be cropped to the radius.
 *
 *    THE HAZARD IS DOM-RENDERED OVERLAYS, NOT EVERY DROPDOWN — the distinction
 *    matters or the rule gets applied superstitiously. A native `<select>` is
 *    SAFE: the browser paints its option list as an OS-level popup outside the
 *    page's layout and stacking context, so an ancestor's overflow cannot touch
 *    it. That is why `TablePagination`'s rows-per-page select inside a clipped
 *    table card is fine, and a report that it is clipped should be refuted
 *    rather than "fixed". What IS at risk is anything rendered as real DOM
 *    inside the card and positioned out of flow: `useAnchoredPopover` panels,
 *    `MultiSelectFilter`, a SearchBox result list, a custom date picker.
 *
 *    A THIRD DIFFERENCE, FOUND DURING MIGRATION: `.card` sets no `display`, so
 *    it is a BLOCK; `Card` is `flex flex-col`, which brings `align-items:
 *    stretch`. Any DIRECT child that used to be shrink-to-fit — a lone button,
 *    a chip, an inline badge — now spans the full width. It is a silent visual
 *    change, not an error. Give such a child `self-start` (or wrap it), and
 *    check the direct children whenever converting a card that held a single
 *    control.
 *
 * 2. NO `backdrop-filter`. `.card` blurs its backdrop for the dark glass look.
 *    Over an opaque white light-mode card that renders nothing while still
 *    forcing a compositor layer, so it was pure cost on the light default.
 *
 * Padding comes from `--pad-card`, which is re-pointed under
 * `html[data-density='compact']`. Never hardcode a padding here.
 */
import { forwardRef } from 'react'

const PAD = {
  default: 'var(--pad-card)',
  tight: 'var(--pad-card-tight)',
  none: '0',
}

const TONE_BORDER = {
  default: 'var(--border-brand)',
  info: 'color-mix(in srgb, #38bdf8 32%, var(--border-brand))',
  good: 'color-mix(in srgb, #22c55e 32%, var(--border-brand))',
  warn: 'color-mix(in srgb, #f5a524 34%, var(--border-brand))',
  crit: 'color-mix(in srgb, #f26161 34%, var(--border-brand))',
}

/**
 * @param {'default'|'tight'|'none'} pad     padding step (density-aware)
 * @param {'default'|'info'|'good'|'warn'|'crit'} tone  border tint only — never
 *        the whole surface, so a wall of cards stays scannable
 * @param {boolean} interactive  adds hover/focus affordance; use ONLY when the
 *        whole card is genuinely clickable
 * @param {boolean} clip         opt in to overflow:hidden (media/chart cards)
 * @param {boolean} accent       vivid top edge for a lead card
 */
const Card = forwardRef(function Card(
  {
    pad = 'default',
    tone = 'default',
    interactive = false,
    clip = false,
    accent = false,
    as: Tag = 'div',
    className = '',
    style,
    children,
    ...rest
  },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={[
        'tp-card relative flex flex-col',
        interactive ? 'tp-card--interactive' : '',
        clip ? 'overflow-hidden' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{
        padding: PAD[pad] ?? PAD.default,
        background: 'var(--card-from)',
        // `border` and `box-shadow` STAY INLINE so stray `border-*` utility
        // classes remain inert and `tone` is the one route - but they resolve
        // through variables that `.tp-card` owns, so :hover can still re-point
        // them. Writing the tone straight into `borderColor` was the bug: the
        // hover cue was dead on every interactive card, while `cursor` and the
        // focus ring worked, because those two are never set inline.
        // The component writes ONLY `--tp-card-tone`; see index.css.
        '--tp-card-tone': TONE_BORDER[tone] ?? TONE_BORDER.default,
        border: '1px solid var(--tp-card-border)',
        boxShadow: 'var(--tp-card-shadow)',
        borderTop: accent ? '2px solid var(--accent)' : undefined,
        borderRadius: 'var(--radius-card)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  )
})

/**
 * CardHeader — title, optional description, optional right-aligned actions.
 * `level` renders a REAL heading element so the page keeps a sequential h1→h6
 * outline for screen readers; it is not a font-size switch.
 *
 * `actions` IS `flex-shrink-0` AND THEREFORE CANNOT WRAP. That is right for one
 * or two controls, which should never be squeezed by a long title. It is wrong
 * for a row of filter or quick-range buttons: an inner `flex-wrap` inside a
 * non-shrinking box has nothing to wrap against, so on a phone the row pushes
 * the card wider and the page gains horizontal scroll — which `ux` rules treat
 * as a defect, and which is invisible at desktop width. Put a multi-button
 * group on its own wrapping row beneath the header instead.
 *
 * Note the padding asymmetry with `Card`: CardHeader sets NO inline padding, so
 * `px-*`/`py-*` classes work here. It does set `marginBottom` inline, which is
 * why overriding that needs `!mb-0`.
 */
export function CardHeader({
  title,
  description,
  actions,
  level = 3,
  icon: Icon,
  className = '',
  children,
}) {
  const H = `h${Math.min(6, Math.max(1, level))}`
  return (
    <div
      className={`flex items-start justify-between gap-[var(--space-3)] ${className}`}
      style={{ marginBottom: title || description ? 'var(--space-4)' : 0 }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[var(--space-2)] min-w-0">
          {Icon && <Icon size={16} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
          {title && (
            <H
              className="truncate"
              style={{
                fontSize: 'var(--fs-md)',
                fontWeight: 'var(--fw-semibold)',
                lineHeight: 'var(--lh-tight)',
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              {title}
            </H>
          )}
        </div>
        {description && (
          <p
            style={{
              fontSize: 'var(--fs-sm)',
              lineHeight: 'var(--lh-snug)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
              marginBottom: 0,
            }}
          >
            {description}
          </p>
        )}
        {children}
      </div>
      {actions && <div className="flex items-center gap-[var(--space-2)] flex-shrink-0">{actions}</div>}
    </div>
  )
}

/** CardBody — the content well. `grow` makes equal-height cards in a grid. */
export function CardBody({ grow = false, className = '', style, children }) {
  return (
    <div className={`min-w-0 ${grow ? 'flex-1' : ''} ${className}`} style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)', ...style }}>
      {children}
    </div>
  )
}

/** CardFooter — separated action row; sits at the bottom of an equal-height card. */
export function CardFooter({ className = '', style, children }) {
  return (
    <div
      className={`flex items-center justify-end gap-[var(--space-2)] ${className}`}
      style={{
        marginTop: 'var(--space-4)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-dim)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * CardGrid — one responsive grid with one gap token, so two sections of cards on
 * the same page can never disagree about their gutter.
 * `min` is the smallest a card may get before the grid reflows.
 */
export function CardGrid({ min = '260px', className = '', style, children }) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gap: 'var(--gap-grid)',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}, 100%), 1fr))`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export default Card
