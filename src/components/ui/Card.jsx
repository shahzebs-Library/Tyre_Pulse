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
        color: 'var(--card-text)',
        border: '1px solid',
        borderColor: TONE_BORDER[tone] ?? TONE_BORDER.default,
        borderTop: accent ? '2px solid var(--accent)' : undefined,
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
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
