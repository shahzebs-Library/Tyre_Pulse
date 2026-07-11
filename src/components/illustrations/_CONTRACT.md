# Tyre Pulse Illustration System — Contributor Contract

Read this fully before adding illustrations. Following it keeps the artwork
consistent and lets many people add files in parallel with **zero conflicts**
(the registry auto-discovers files — there is no central index to edit).

## File rules
- One illustration per file: `src/components/illustrations/<category>/<kebab-name>.illustration.jsx`
- The registry name is the path minus `.illustration.jsx`, e.g.
  `module/fleet.illustration.jsx` → registered as **`module/fleet`**.
- **Default-export** a single React component. No side effects, no data fetching.
- Do **not** edit `registry.js`, `index.js`, `primitives.jsx`, `tokens.js`,
  `Illustration.jsx`, `EmptyState.jsx`, or `StateScreen.jsx` — only ADD files in
  your assigned category folder(s).
- Do **not** run git, switch branches, commit, or add npm dependencies.

## Component rules (copy `state/no-data.illustration.jsx`)
- Signature: `export default function X({ size = 200, title, desc, animate = true, ...rest })`.
- Render an `<IllustrationBase title={title} desc={desc} size={size} animate={animate} {...rest}>`
  from `../primitives`. It provides the accessible, motion-safe `<svg>` shell.
- Colours: import `{ C, G }` (C = palette, G = geometry) from `../tokens` and/or
  use `var(--…)` directly. **Never hard-code a theme hex** (no `#111`, `#fff`,
  `#0f172a`, etc.) for surfaces/ink — those must be tokens so Light/Dark and
  per-tenant brand colours work. Brand accents come from `C.brand`/`C.accent`.
- Gradients/shadows/glows: call `const d = useDefs()` and render `<BrandDefs d={d} />`,
  then reference `fill={\`url(#${d.brand})\`}` etc. This namespaces ids so two
  illustrations on one page never collide.
- Motion: use the re-exported `motion` + `useReducedMotion` from `../primitives`.
  Keep it subtle (slow float, gentle rotate, pulse) and always disabled when the
  user prefers reduced motion or `animate === false`.
- Geometry: consistent `G.stroke` / `G.radius`, rounded line caps, layered depth
  (soft shadow + ambient glow), premium industrial fleet/tyre aesthetic. Not flat
  clipart.
- Keep the default viewBox `0 0 240 180` unless the composition needs another
  aspect (pass `viewBox` to `IllustrationBase`).

## Usage (for reference — don't wire unless assigned)
```jsx
import { Illustration } from '@/components/illustrations'
<Illustration name="module/fleet" size={220} title="No vehicles yet" />
```
`EmptyState` accepts an `illustration="state/no-data"` prop; `StateScreen` renders
full-page states (404/500/offline/etc).
