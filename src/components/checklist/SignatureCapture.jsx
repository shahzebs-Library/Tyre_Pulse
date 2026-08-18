import { useCallback, useRef, useState } from 'react'
import { PenLine, RotateCcw } from 'lucide-react'

/**
 * Draw a signature, and store it in the SAME format the phone stores.
 *
 * WHY NOT THE EXISTING PAD. src/components/SignaturePad.jsx draws on a <canvas>
 * and exports a PNG data URL; the field app draws with react-native-svg and
 * exports self-contained `<svg>` markup. Two formats for one column means every
 * reader needs a special case, and one of them was missing - a phone-drawn
 * signature simply did not render on the web. This pad emits the SVG shape, so
 * from here on both stacks store the same thing.
 *
 * The markup is a static `<svg>` holding only `<path>` elements built from the
 * points this component recorded. It never embeds anything a viewer would have
 * to fetch or execute.
 */
function buildSvg(strokes, width, height) {
  const body = strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const d = s.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
      return `<path d="${d}" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    .join('')
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}

export { buildSvg }

/**
 * @param {object} props
 * @param {(svg:string|null)=>void} props.onChange  fires with the markup, or null when cleared
 * @param {string} [props.label]
 * @param {number} [props.height]
 */
export default function SignatureCapture({ onChange, label = 'Sign here', height = 130 }) {
  const boxRef = useRef(null)
  const drawing = useRef(false)
  // The strokes live in a ref, not in state, and that is deliberate. Reading
  // them back inside a state updater to hand them to the parent calls the
  // parent's setState during a render, which React refuses ("Cannot update a
  // component while rendering a different component"). The ref is the record;
  // `tick` exists only to repaint.
  const strokesRef = useRef([])
  const [tick, setTick] = useState(0)
  const redraw = () => setTick((t) => t + 1)

  const point = useCallback((e) => {
    const rect = boxRef.current?.getBoundingClientRect()
    const src = e.touches?.[0] || e
    return { x: (src.clientX ?? 0) - (rect?.left ?? 0), y: (src.clientY ?? 0) - (rect?.top ?? 0) }
  }, [])

  const emit = useCallback((strokes) => {
    const rect = boxRef.current?.getBoundingClientRect()
    const drawn = strokes.some((s) => s.length > 0)
    onChange?.(drawn ? buildSvg(strokes, rect?.width || 320, rect?.height || height) : null)
  }, [onChange, height])

  function start(e) {
    e.preventDefault?.()
    drawing.current = true
    strokesRef.current = [...strokesRef.current, [point(e)]]
    redraw()
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault?.()
    const all = strokesRef.current
    if (!all.length) return
    const last = all[all.length - 1]
    strokesRef.current = [...all.slice(0, -1), [...last, point(e)]]
    redraw()
  }

  function end(e) {
    if (!drawing.current) return
    e?.preventDefault?.()
    drawing.current = false
    emit(strokesRef.current)
  }

  function clear() {
    drawing.current = false
    strokesRef.current = []
    redraw()
    onChange?.(null)
  }

  const strokes = strokesRef.current
  void tick

  const hasInk = strokes.some((s) => s.length > 0)

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] inline-flex items-center gap-1.5">
          <PenLine className="w-3 h-3" /> {label}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      </div>
      <div
        ref={boxRef}
        role="application"
        aria-label={label}
        data-testid="signature-capture"
        className="relative rounded-xl border border-[var(--input-border)] bg-white touch-none select-none cursor-crosshair overflow-hidden"
        style={{ height }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      >
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          {strokes.map((s, i) => (
            <path
              key={i}
              d={s.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}
              fill="none"
              stroke="#111827"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        {!hasInk && (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
            Draw your signature here
          </span>
        )}
      </div>
    </div>
  )
}
