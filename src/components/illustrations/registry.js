/**
 * Illustration registry — auto-discovers every `*.illustration.jsx` under this
 * folder and keys it by its path-derived name (e.g. `state/no-data`,
 * `module/fleet`). Using a Vite glob means contributors only ADD files — there
 * is no central index to edit, so parallel work never conflicts here.
 *
 * Name = relative path minus the leading `./`, the category folder is kept, and
 * the `.illustration.jsx` suffix is stripped:  `./state/no-data.illustration.jsx`
 * → `state/no-data`.
 */

// Eager so the registry is a plain object (works in the app and in tests).
const modules = import.meta.glob('./**/*.illustration.jsx', { eager: true })

function deriveName(path) {
  return path
    .replace(/^\.\//, '')
    .replace(/\.illustration\.jsx$/, '')
}

/** name → React component (default export of each illustration file). */
export const ILLUSTRATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(modules)
      .map(([path, mod]) => [deriveName(path), mod.default])
      .filter(([, comp]) => typeof comp === 'function'),
  ),
)

/** All registered illustration names, sorted. */
export const ILLUSTRATION_NAMES = Object.freeze(Object.keys(ILLUSTRATIONS).sort())

/** Look up an illustration component by name (or `null`). */
export function getIllustration(name) {
  return ILLUSTRATIONS[name] || null
}

/** True if an illustration is registered under `name`. */
export function hasIllustration(name) {
  return Boolean(ILLUSTRATIONS[name])
}
