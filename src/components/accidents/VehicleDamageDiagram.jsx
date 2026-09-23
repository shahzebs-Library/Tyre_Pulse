/**
 * VehicleDamageDiagram - the drawing surface of the "Mark damage" case tab.
 *
 * Renders ONE view of the asset's own vehicle artwork (the same five-view board
 * the phone shows, src/lib/vehicleArtwork.js) with the audited component
 * rectangles from src/lib/vehicleDamageZones.js placed on top as keyboard
 * reachable hit targets. A marked component carries its number and its severity
 * tint, exactly as it does on the phone.
 *
 * PRESENTATIONAL ONLY: no fetching, no mark model, no geometry of its own. The
 * caller resolves the image, the zones and the marks and passes them in.
 *
 * Coordinates are the view's own 0..1 fractions, emitted as percentages, so the
 * whole surface scales with its container and stays correct at phone width.
 *
 * WHEN THERE IS NO ARTWORK the resolver returns null on purpose - a concrete
 * pump whose axle count is not proven, a wheel loader that is not a SANY - and
 * this renders an honest fallback that still lets every component be marked by
 * name. It NEVER borrows another vehicle's drawing: a mark placed on the wrong
 * body is worse than a mark placed on no body.
 */
import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { SEVERITY_DOT_TONE } from '../../lib/vehicleDamageViews'

function toneFor(severity) {
  return SEVERITY_DOT_TONE[severity] || SEVERITY_DOT_TONE.minor
}

/** "1. Front bumper: Dent . Major . 2 photos" - the one accessible name a zone
 *  answers to, marked or not. Kept identical to the caption the panel prints. */
function zoneAccessibleName(zone, entry) {
  if (!entry) return zone.label
  const summary = entry.summary ? `: ${entry.summary}` : ''
  return `${entry.number}. ${zone.label}${summary}`
}

function MarkerBadge({ entry, size = 'md' }) {
  const px = size === 'sm' ? 16 : 20
  return (
    <span
      data-testid={`marker-${entry.number}`}
      className="rounded-full font-bold text-black flex items-center justify-center shadow ring-1 ring-black/30"
      style={{
        backgroundColor: toneFor(entry.severity),
        minWidth: px,
        height: px,
        fontSize: size === 'sm' ? 10 : 11,
        paddingLeft: 3,
        paddingRight: 3,
      }}
    >
      {entry.number}
    </span>
  )
}

export default function VehicleDamageDiagram({
  imageSrc,
  view,
  viewName,
  zones = [],
  marks,
  selectedZoneId,
  onSelectZone,
  disabled = false,
}) {
  const [imageFailed, setImageFailed] = useState(false)
  // A new view (or a new asset) gets a fresh chance to load; without this a
  // single broken face would strand every later view on the fallback.
  useEffect(() => { setImageFailed(false) }, [imageSrc])

  const entryFor = (zoneId) => (marks && typeof marks.get === 'function' ? marks.get(zoneId) : marks?.[zoneId]) || null
  const hasArtwork = Boolean(imageSrc) && !imageFailed
  const faceName = viewName || view || 'vehicle'

  if (!zones.length) {
    return (
      <div
        data-testid="damage-surface"
        data-surface={hasArtwork ? 'artwork' : 'no-artwork'}
        className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-6 text-center"
      >
        <p className="text-xs text-[var(--text-muted)]">
          No components are mapped for the {faceName.toLowerCase()} view of this asset. Pick another view.
        </p>
      </div>
    )
  }

  // No drawing for this asset: the components are still every bit as markable,
  // they are just named rather than pointed at. Floating rectangles over an
  // empty box would imply a silhouette that is not there.
  if (!hasArtwork) {
    return (
      <div
        data-testid="damage-surface"
        data-surface="no-artwork"
        className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3 space-y-3"
      >
        <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5" data-testid="no-artwork-note">
          <ImageOff size={12} className="mt-0.5 shrink-0" />
          No approved drawing for this asset, so the {faceName.toLowerCase()} view is listed by component instead. Marking works the same way.
        </p>
        <div className="flex flex-wrap gap-2">
          {zones.map((z) => {
            const entry = entryFor(z.id)
            const isSelected = selectedZoneId === z.id
            return (
              <button
                key={z.id}
                type="button"
                aria-label={zoneAccessibleName(z, entry)}
                aria-pressed={isSelected}
                disabled={disabled && !entry}
                onClick={() => onSelectZone?.(z)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-tight transition-colors disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                  entry
                    ? 'border-amber-500/60 bg-amber-900/10 text-amber-200'
                    : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                } ${isSelected ? 'ring-2 ring-green-500' : ''}`}
              >
                {entry && <MarkerBadge entry={entry} size="sm" />}
                {z.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="damage-surface"
      data-surface="artwork"
      className="relative w-full max-w-[520px] mx-auto rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 overflow-hidden"
      style={{ aspectRatio: '1 / 1' }}
    >
      <img
        src={imageSrc}
        alt={`${faceName} view of the vehicle`}
        onError={() => setImageFailed(true)}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
        draggable={false}
      />
      {zones.map((z) => {
        const entry = entryFor(z.id)
        const isSelected = selectedZoneId === z.id
        return (
          <button
            key={z.id}
            type="button"
            data-testid={`zone-${z.id}`}
            aria-label={zoneAccessibleName(z, entry)}
            aria-pressed={isSelected}
            title={z.label}
            disabled={disabled && !entry}
            onClick={() => onSelectZone?.(z)}
            style={{
              position: 'absolute',
              left: `${z.left * 100}%`,
              top: `${z.top * 100}%`,
              width: `${z.width * 100}%`,
              height: `${z.height * 100}%`,
              backgroundColor: entry ? `${toneFor(entry.severity)}38` : 'transparent',
              borderColor: entry ? toneFor(entry.severity) : undefined,
            }}
            className={`group rounded-[3px] border transition-colors disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:z-20 ${
              entry
                ? 'border-solid'
                : 'border-dashed border-white/25 hover:border-green-400 hover:bg-green-400/15'
            } ${isSelected ? 'ring-2 ring-green-400 z-10' : ''}`}
          >
            <span className="absolute inset-0 flex items-center justify-center">
              {entry && <MarkerBadge entry={entry} />}
            </span>
            {/* The component name, revealed on hover or keyboard focus so the
                drawing stays readable while every target still says what it is. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 -translate-y-full whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 z-30"
            >
              {z.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
