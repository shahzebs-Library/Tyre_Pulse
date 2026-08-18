import { useState } from 'react'
import { X, ZoomIn } from 'lucide-react'
import { safeImageSrc } from '../../lib/safeUrl'

/**
 * A captured signature, rendered wherever one has to be LOOKED AT.
 *
 * THE BUG THIS EXISTS TO FIX. The two stacks capture a signature in two formats:
 * the web pad emits a PNG data URL, the phone emits self-contained `<svg>`
 * MARKUP. Every web surface rendered both through `<img src={value}>`, and a raw
 * `<svg …>` string is not a URL - so a signature drawn on the phone, which is
 * where nearly all of them are drawn, rendered as a broken image. A sign-off
 * nobody can see is indistinguishable from one that was never given.
 *
 * Markup is turned into a `data:image/svg+xml` URL rather than injected into the
 * DOM. An SVG loaded through `<img>` cannot run script or fetch anything, so a
 * signature that arrived from a device can never become an injection point -
 * which `dangerouslySetInnerHTML` would have made it.
 */
export function signatureSrc(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  if (s.slice(0, 4).toLowerCase() === '<svg') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`
  }
  return safeImageSrc(s) || null
}

/**
 * @param {object} props
 * @param {string} [props.value]   the stored signature (PNG data URL or SVG markup)
 * @param {string} [props.label]   what this signature is, e.g. "Supervisor"
 * @param {string} [props.name]    the printed name beside it
 * @param {string} [props.emptyText] what an unsigned line reads as
 */
export default function SignatureView({
  value, label = null, name = null, emptyText = 'Not signed', height = 80,
}) {
  const [open, setOpen] = useState(false)
  const src = signatureSrc(value)

  return (
    <div className="min-w-[150px]">
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open this signature"
          className="group relative block rounded-lg overflow-hidden border border-[var(--border-dim)] bg-white"
          style={{ height }}
        >
          <img src={src} alt={label ? `${label} signature` : 'Signature'} className="h-full w-auto max-w-[220px] object-contain p-1.5" />
          <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/30 text-white">
            <ZoomIn className="w-4 h-4" />
          </span>
        </button>
      ) : (
        // An unsigned line is shown as unsigned rather than dropped: a missing
        // sign-off is itself the finding.
        <div
          className="rounded-lg border border-dashed border-[var(--border-dim)] flex items-center justify-center text-xs text-[var(--text-dim)]"
          style={{ height }}
        >
          {emptyText}
        </div>
      )}
      {label && <p className="text-xs text-[var(--text-muted)] mt-1.5">{label}</p>}
      <p className="text-sm text-[var(--text-primary)]">
        {name || <span className="text-[var(--text-dim)]">Name not recorded</span>}
      </p>

      {open && src && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-label={label ? `${label} signature` : 'Signature'}
          onClick={() => setOpen(false)}
        >
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-xl bg-white p-4">
              <img src={src} alt={label ? `${label} signature` : 'Signature'} className="w-full h-auto max-h-[70vh] object-contain" />
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              <p className="text-sm text-white/90">
                {[label, name].filter(Boolean).join(' - ') || 'Signature'}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white bg-white/10 hover:bg-white/20 border border-white/20"
              >
                <X className="w-4 h-4" /> Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
