/**
 * Custom icon registry — auto-discovers every `*.icon.jsx` under this folder and
 * keys it by its file name (e.g. `tyre`, `tread-depth`). Glob-based, so icons are
 * added in parallel with no central index to edit and no merge conflicts.
 */
const modules = import.meta.glob('./**/*.icon.jsx', { eager: true })

function deriveName(path) {
  return path.split('/').pop().replace(/\.icon\.jsx$/, '')
}

/** name → React icon component (default export). */
export const ICONS = Object.freeze(
  Object.fromEntries(
    Object.entries(modules)
      .map(([path, mod]) => [deriveName(path), mod.default])
      .filter(([, comp]) => typeof comp === 'function'),
  ),
)

export const ICON_NAMES = Object.freeze(Object.keys(ICONS).sort())

export function getIcon(name) {
  return ICONS[name] || null
}

export function hasIcon(name) {
  return Boolean(ICONS[name])
}
