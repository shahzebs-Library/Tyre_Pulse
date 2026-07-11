# Tyre Pulse Custom Icon Set — Contributor Contract

A domain-specific stroke-icon family that sits beside Lucide. Following this keeps
the set visually uniform and conflict-free (the registry auto-discovers files —
no central index to edit).

## File rules
- One icon per file: `src/components/icons/<kebab-name>.icon.jsx`
- Registry name = file name minus `.icon.jsx` (`tread-depth.icon.jsx` → `tread-depth`).
- **Default-export** a single component. No data, no side effects.
- Do **not** edit `IconBase.jsx`, `registry.js`, `index.js`, `Icon.jsx`. Only ADD files.
- Do **not** run git, switch branches, commit, or add npm dependencies.

## Component rules (copy `tyre.icon.jsx`)
```jsx
import IconBase from './IconBase'
export default function TreadDepthIcon(props) {
  return (
    <IconBase {...props}>
      {/* paths here */}
    </IconBase>
  )
}
```
- Render everything inside `<IconBase {...props}>`. It sets the 24×24 viewBox,
  `fill="none"`, `stroke="currentColor"`, stroke width 1.75, round caps/joins,
  and forwards `size` / `title` / `className`.
- **Draw on a 24×24 grid.** Keep ~2px padding from the edges (content roughly
  within 2–22). Optically balance the weight with Lucide icons.
- **Stroke only** — no `fill` (except `fill="currentColor"` for a tiny solid dot
  when unavoidable). **Never** hard-code a colour; `currentColor` makes icons
  theme-aware automatically.
- Consistent stroke width (inherit IconBase's 1.75 — don't override), rounded
  caps/joins, no text nodes, no gradients, no drop shadows. Clean line art.
- Keep each icon a single visual concept, readable at 16px.

## Usage (reference)
```jsx
import { TpIcon } from '@/components/icons'
<TpIcon name="tread-depth" size={18} />
```
