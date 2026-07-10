// ─────────────────────────────────────────────────────────────────────────────
// chartVarPlugin.js — resolve CSS custom properties for Chart.js canvases.
//
// Chart.js paints to <canvas>, whose 2D context cannot resolve CSS variables:
// a colour string like "var(--panel)" is an invalid canvas colour and silently
// falls back to opaque black (or is ignored), so tooltips, gridlines, ticks and
// dataset colours authored with theme tokens rendered wrong across the app.
//
// This global plugin walks each chart's resolved options + data before layout
// and replaces any "var(--token[, fallback])" occurrence with the live computed
// value read off <html> (where index.css defines both the dark :root defaults
// and the html.light overrides). Because the page rebuilds its option objects
// on every React render, the fresh var() strings flow back in on a theme switch
// and get re-resolved — so charts stay theme-reactive without per-page work.
//
// Registered once, globally, in main.jsx; applies to every Chart instance.
// ─────────────────────────────────────────────────────────────────────────────

// Matches a single var() reference, capturing the token name and optional
// fallback: var(--panel)  /  var(--panel, #fff)  /  var( --x , rgba(0,0,0,.5) )
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g

// Per-render memo so repeated tokens in one chart resolve once.
let _cache = null

function readVar(name) {
  if (typeof document === 'undefined') return ''
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  } catch {
    return ''
  }
}

/** Replace every var() reference in a colour string with its computed value. */
function resolveVarString(str) {
  return str.replace(VAR_RE, (_m, name, fallback) => {
    let v = _cache.get(name)
    if (v === undefined) {
      v = readVar(name)
      _cache.set(name, v)
    }
    if (v) return v
    const fb = (fallback || '').trim()
    // No token + no fallback → transparent, never opaque-black canvas default.
    return fb || 'rgba(0,0,0,0)'
  })
}

/**
 * Depth-first walk that rewrites in place any string value containing a var()
 * reference. Only descends into plain objects and arrays, so Chart.js internals
 * (canvas contexts, elements, functions) are never touched. A WeakSet guards
 * against the cyclic references Chart.js keeps between scales and the chart.
 */
function walk(node, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  const proto = Object.getPrototypeOf(node)
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return
  seen.add(node)
  for (const key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue
    const val = node[key]
    if (typeof val === 'string') {
      if (val.indexOf('var(--') !== -1) node[key] = resolveVarString(val)
    } else if (val && typeof val === 'object') {
      walk(val, seen)
    }
  }
}

export const chartVarResolverPlugin = {
  id: 'cssVarResolver',
  // beforeLayout runs after options/data are set but before any pixels are
  // computed, so tooltips, scales and elements all read resolved colours.
  beforeLayout(chart) {
    _cache = new Map()
    const seen = new WeakSet()
    walk(chart.options, seen)
    walk(chart.data, seen)
    _cache = null
  },
}

export default chartVarResolverPlugin
