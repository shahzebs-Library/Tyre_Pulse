/**
 * IconBase — the shared shell for the Tyre Pulse custom icon set. A 24×24
 * stroke-based icon system tuned to sit beside Lucide: `currentColor`, uniform
 * stroke width, round caps/joins. Because icons paint with `currentColor` they
 * are theme-aware for free — they inherit the text colour of their context in
 * Light, Dark and every tenant palette.
 *
 * Contributors: see icons/_CONTRACT.md. One icon per `*.icon.jsx` file; the
 * registry auto-discovers them, so files are added in parallel with no conflicts.
 */
import { forwardRef } from 'react'

export const ICON_STROKE = 1.75

const IconBase = forwardRef(function IconBase(
  { size = 24, title, strokeWidth = ICON_STROKE, className = '', children, ...rest },
  ref,
) {
  const a11y = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': true, focusable: false }
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`tp-icon ${className}`}
      {...a11y}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
})

export default IconBase
