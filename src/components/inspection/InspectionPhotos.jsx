import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Download, ImageOff, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { normalizeTyreConditions, positionLabelMap } from '../../lib/inspectionView'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { safeHref, safeImageSrc } from '../../lib/safeUrl'

/**
 * The evidence an inspector captured: the pictures, the meters and the signatures.
 *
 * A photograph is the only part of an inspection that is not somebody's opinion,
 * and until now it was the part hardest to see: unlabelled 96px thumbnails, no
 * way to open one, and a photo whose signed URL failed rendered as a gap that
 * read exactly like "no photo was taken". Those are opposite statements and the
 * difference decides whether a manager trusts the record, so every photo here
 * carries the position it belongs to and every failure says so in words.
 *
 * Photos are stored as `tp-storage://` refs and must be signed before display,
 * which is asynchronous and can fail per photo. Each one is therefore resolved
 * and reported independently: one dead ref never blanks the gallery.
 *
 * This component does not fetch the inspection. It renders a row somebody else
 * loaded, so it can sit inside the drawer, a full page or a print view without
 * three of them racing for the same record.
 */

/** Group keys. Position photos are evidence for one wheel; general ones are context. */
export const GROUP_POSITION = 'position'
export const GROUP_GENERAL = 'general'

const GROUP_TITLE = {
  [GROUP_POSITION]: 'Tyre positions',
  [GROUP_GENERAL]: 'Inspection photos',
}

/** A usable ref is a non-empty string. Anything else is absent, not a photo. */
function refOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Read the row-level photo column into a list of refs.
 *
 * `photo_data` is a single text column, but it has held one ref, a JSON array
 * (the checklist tab captures several and keeps the rest alongside) and a bare
 * data URL over the years. A value that merely starts with "[" but does not
 * parse is treated as one ref rather than discarded: dropping a photo because
 * its own text looked like JSON would lose real evidence.
 */
export function toRefList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(refOf).filter(Boolean)
  if (typeof value !== 'string') return []
  const s = value.trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return parsed.map(refOf).filter(Boolean)
    } catch {
      // Not JSON after all. Fall through and keep it as a single ref.
    }
  }
  return [s]
}

/**
 * Every photo on an inspection, each labelled with what it shows.
 *
 * Position photos are read from the normalised tyre_conditions rather than from
 * `tyreReadingRows`, deliberately: that helper drops a position with no
 * condition, pressure, tread or note, so a wheel someone ONLY photographed
 * would have no row and its picture would disappear. A photograph is a
 * recording in its own right.
 *
 * The caption names the wheel the way the diagram and the position summary do,
 * via `positionLabelMap`. It used to print the stored key, so a photo captioned
 * F2R sat under a summary line reading "RHF2 Puncture" - the same wheel, twice,
 * in two vocabularies, leaving the reader to pair them up on a safety record.
 *
 * @param {object|null} row inspection row
 * @returns {Array<{key:string, ref:string, group:string, label:string, detail:string|null}>}
 */
export function collectPhotoRefs(row) {
  if (!row) return []
  const out = []

  const conditions = normalizeTyreConditions(row)
  const labels = positionLabelMap(row)
  for (const [position, d] of Object.entries(conditions)) {
    const ref = refOf(d?.photo)
    if (!ref) continue
    out.push({
      key: `position:${position}`,
      ref,
      group: GROUP_POSITION,
      label: labels[position] || position,
      detail: d.condition || null,
    })
  }

  // Same ref can appear in both columns (the checklist tab writes its first
  // photo to photo_data and keeps the set in custom_data), so dedupe before
  // numbering or the labels would read "1 of 3" over two distinct pictures.
  const seen = new Set()
  const general = []
  for (const ref of [...toRefList(row.photo_data), ...toRefList(row.custom_data?.photos)]) {
    if (seen.has(ref)) continue
    seen.add(ref)
    general.push(ref)
  }
  general.forEach((ref, i) => {
    out.push({
      key: `general:${i}`,
      ref,
      group: GROUP_GENERAL,
      label: general.length > 1 ? `Inspection photo ${i + 1} of ${general.length}` : 'Inspection photo',
      detail: null,
    })
  })

  return out
}

/** Ordered, non-empty groups for rendering. Position evidence leads. */
export function groupPhotos(photos) {
  const list = Array.isArray(photos) ? photos : []
  return [GROUP_POSITION, GROUP_GENERAL]
    .map((key) => ({ key, title: GROUP_TITLE[key], items: list.filter((p) => p.group === key) }))
    .filter((g) => g.items.length > 0)
}

/** How many photos are still signing, usable, or beyond reach. */
export function gallerySummary(items) {
  const list = Array.isArray(items) ? items : []
  let ready = 0
  let failed = 0
  let pending = 0
  for (const it of list) {
    if (it.status === 'ready') ready += 1
    else if (it.status === 'failed') failed += 1
    else pending += 1
  }
  return { total: list.length, ready, failed, pending }
}

/**
 * What the gallery is actually saying.
 *
 * 'unknown' (no row) and 'none' (a row that carries no photo) look identical on
 * screen unless they are separated here: one means we could not look, the other
 * means nobody took a picture.
 */
export function galleryState(row, photos) {
  if (!row) return 'unknown'
  return (Array.isArray(photos) ? photos.length : 0) > 0 ? 'photos' : 'none'
}

/**
 * A plain sentence about photos that did not resolve, or null when there is
 * nothing to explain. Silence when every photo loaded: a banner nobody needs is
 * a banner nobody reads.
 */
export function galleryNotice(state, summary) {
  if (state === 'unknown') return 'The inspection has not loaded, so its photos cannot be shown.'
  if (state === 'none') return 'No photos were taken on this inspection.'
  const s = summary || { total: 0, failed: 0 }
  if (!s.failed) return null
  if (s.failed === s.total) {
    return s.total === 1
      ? 'The photo on this inspection could not be loaded. It was taken, so it may be a temporary access problem.'
      : `None of the ${s.total} photos could be loaded. They were taken, so this may be a temporary access problem.`
  }
  return `${s.failed} of ${s.total} photos could not be loaded. The rest are shown below.`
}

/**
 * How a stored signature should be rendered.
 *
 * There are two shapes in the data and only one of them was ever handled: the
 * web pad saves a PNG data URL, the mobile pad saves a raw `<svg>` string, and
 * a legacy capture can be a typed name. An SVG string is wrapped as a data URL
 * and shown through an `<img>` rather than injected as markup, because an image
 * document cannot run script, so a poisoned signature column stays inert.
 *
 * @returns {{kind:'none'}|{kind:'image', src:string}|{kind:'typed', text:string}}
 */
export function signatureView(value) {
  if (typeof value !== 'string') return { kind: 'none' }
  const s = value.trim()
  if (!s) return { kind: 'none' }

  if (s.startsWith('<svg')) {
    const src = safeImageSrc(`data:image/svg+xml;utf8,${encodeURIComponent(s)}`)
    return src ? { kind: 'image', src } : { kind: 'none' }
  }
  // Only real image URLs get an <img>. A bare name has no scheme, which
  // safeImageSrc treats as a relative path, and rendering it would produce a
  // broken image where the record actually holds a typed signature.
  if (/^(https?:|data:|blob:)/i.test(s)) {
    const src = safeImageSrc(s)
    return src ? { kind: 'image', src } : { kind: 'none' }
  }
  // Anything else carrying a scheme is a URL we chose not to trust. Printing it
  // as the typed name would be inert but would show an attacker's string as if
  // an inspector had signed it, so it is dropped instead.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return { kind: 'none' }
  return { kind: 'typed', text: s }
}

/** Underscored database tokens are not sentences. */
export function prettyApproval(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return null
  const words = s.replace(/[_-]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A recorded meter reading, or null. Zero is a reading; blank is not. */
function meterText(value, unit) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return `${n.toLocaleString('en-US')} ${unit}`
}

const CELL = { background: 'var(--panel-2)', border: '1px solid var(--border-subtle)' }

/* ------------------------------------------------------------------ lightbox */

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * One photo, full size, with the rest reachable by arrow key.
 *
 * Focus is trapped and restored because this covers the whole screen: a
 * keyboard user who tabs out of it is left operating a page they cannot see.
 */
function PhotoLightbox({ items, index, onIndex, onClose }) {
  const dialogRef = useRef(null)
  const restoreRef = useRef(null)
  const item = items[index]

  useEffect(() => {
    restoreRef.current = document.activeElement
    const el = dialogRef.current
    if (el) el.focus()
    return () => {
      const back = restoreRef.current
      if (back && typeof back.focus === 'function') back.focus()
    }
  }, [])

  // Capture phase on window, not a React handler: the drawer underneath also
  // listens for Escape, and only stopping the event before it reaches that
  // listener closes the photo first instead of closing both at once.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); onIndex((index + 1) % items.length); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onIndex((index - 1 + items.length) % items.length); return }
      if (e.key !== 'Tab') return

      const nodes = dialogRef.current ? Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)) : []
      if (!nodes.length) { e.preventDefault(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      const inside = dialogRef.current && dialogRef.current.contains(active)
      if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, items.length, onClose, onIndex])

  if (!item) return null
  const src = item.status === 'ready' ? safeImageSrc(item.url) : null
  const href = item.status === 'ready' ? safeHref(item.url) : undefined

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Photo: ${item.label}`}
        className="flex flex-col h-full outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 shrink-0">
          <div className="min-w-0 text-white">
            <div className="text-sm font-semibold truncate">{item.label}</div>
            <div className="text-xs opacity-70">
              {item.detail ? `${item.detail} | ` : ''}Photo {index + 1} of {items.length}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs inline-flex items-center gap-1 rounded px-2 py-1.5 text-white"
                style={{ background: 'rgba(255,255,255,0.15)' }}
              >
                <Download className="w-3.5 h-3.5" /> Open original
              </a>
            )}
            <button
              onClick={onClose}
              aria-label="Close photo"
              className="rounded p-1.5 text-white"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-2 pb-4">
          {items.length > 1 && (
            <button
              onClick={() => onIndex((index - 1 + items.length) % items.length)}
              aria-label="Previous photo"
              className="rounded-full p-2 text-white shrink-0"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}

          {src ? (
            <img
              src={src}
              alt={`${item.label} photo`}
              className="max-h-full max-w-full object-contain rounded"
            />
          ) : (
            <div className="text-center text-sm px-6" style={{ color: 'rgba(255,255,255,0.85)' }}>
              <ImageOff className="w-8 h-8 mx-auto mb-2 opacity-70" />
              <div className="font-medium">{item.label}</div>
              <div className="opacity-80 mt-1">
                This photo was taken but could not be loaded.
              </div>
            </div>
          )}

          {items.length > 1 && (
            <button
              onClick={() => onIndex((index + 1) % items.length)}
              aria-label="Next photo"
              className="rounded-full p-2 text-white shrink-0"
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ gallery */

function PhotoTile({ item, onOpen }) {
  const src = item.status === 'ready' ? safeImageSrc(item.url) : null

  return (
    <figure className="w-32">
      {item.status === 'loading' && (
        <div
          className="w-32 h-32 rounded flex items-center justify-center"
          style={CELL}
          aria-busy="true"
        >
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-dim)' }} />
        </div>
      )}

      {item.status === 'ready' && src && (
        <button
          type="button"
          onClick={onOpen}
          className="block w-32 h-32 rounded overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}
          title="Open full size"
        >
          <img src={src} alt={`${item.label} photo`} className="w-full h-full object-cover" />
        </button>
      )}

      {(item.status === 'failed' || (item.status === 'ready' && !src)) && (
        <div
          className="w-32 h-32 rounded flex flex-col items-center justify-center text-center px-2"
          style={CELL}
        >
          <ImageOff className="w-5 h-5 mb-1" style={{ color: 'var(--text-dim)' }} />
          <span className="text-[11px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
            Could not load
          </span>
        </div>
      )}

      <figcaption className="mt-1">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }} title={item.label}>
          {item.label}
        </div>
        {item.detail && (
          <div className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>{item.detail}</div>
        )}
      </figcaption>
    </figure>
  )
}

function EvidenceBlock({ row }) {
  const odometer = meterText(row.odometer_km, 'km')
  const hours = meterText(row.hour_meter, 'hrs')
  const inspector = signatureView(row.inspector_signature)
  const approver = signatureView(row.approver_signature)
  const status = prettyApproval(row.approval_status)
  const approvedOn = row.approved_at ? String(row.approved_at).slice(0, 10) : null
  const approverName = row.approver_email || row.approved_by || null

  const hasAny = odometer || hours || inspector.kind !== 'none' || approver.kind !== 'none' || status
  if (!hasAny) return null

  return (
    <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
        Meters and sign off
      </h3>

      {(odometer || hours) && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[['Odometer', odometer], ['Hour meter', hours]].filter(([, v]) => v).map(([label, value]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: 'var(--panel-2)' }}>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              <div className="text-base font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SignatureBox
          caption={`Inspector${row.inspector ? `: ${row.inspector}` : ''}`}
          view={inspector}
          emptyText="Not signed"
        />
        <SignatureBox
          caption={
            status
              ? `${status}${approverName ? ` by ${approverName}` : ''}${approvedOn ? ` on ${approvedOn}` : ''}`
              : 'Approval'
          }
          view={approver}
          emptyText={status === 'Approved' ? 'Approved without a signature' : 'Not signed'}
        />
      </div>
    </div>
  )
}

function SignatureBox({ caption, view, emptyText }) {
  return (
    <div>
      <div className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{caption}</div>
      <div className="rounded p-2 flex items-center justify-center h-24" style={CELL}>
        {view.kind === 'image' && (
          // White plate: signatures are dark ink and vanish on a dark surface.
          <img
            src={view.src}
            alt="Signature"
            className="max-h-20 max-w-full object-contain rounded"
            style={{ background: '#fff', padding: 4 }}
          />
        )}
        {view.kind === 'typed' && (
          <span className="text-sm italic" style={{ color: 'var(--text-primary)' }}>{view.text}</span>
        )}
        {view.kind === 'none' && (
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{emptyText}</span>
        )}
      </div>
    </div>
  )
}

/**
 * @param {object}  props
 * @param {object|null} props.inspection    loaded inspection row (this does not fetch)
 * @param {boolean} [props.showEvidence]    meters, signatures and approval (default true)
 * @param {string}  [props.title]           heading over the gallery
 */
export default function InspectionPhotos({ inspection, showEvidence = true, title = 'Photos' }) {
  const refs = useMemo(() => collectPhotoRefs(inspection), [inspection])
  const [resolved, setResolved] = useState({})
  const [openIndex, setOpenIndex] = useState(null)

  // Key the effect on the refs themselves, not on the array identity: the row
  // object is rebuilt on every parent render and would otherwise re-sign every
  // photo continuously.
  const refKey = useMemo(() => refs.map((r) => `${r.key}=${r.ref}`).join('|'), [refs])

  useEffect(() => {
    if (!refs.length) { setResolved({}); return undefined }
    let cancelled = false
    setResolved({})
    // Settled per photo, never Promise.all: one ref we cannot sign must not
    // decide whether the other twelve are shown.
    for (const r of refs) {
      resolveStorageUrl(r.ref)
        .then((url) => {
          if (cancelled) return
          setResolved((prev) => ({
            ...prev,
            [r.key]: url ? { status: 'ready', url } : { status: 'failed', url: null },
          }))
        })
        .catch(() => {
          if (!cancelled) setResolved((prev) => ({ ...prev, [r.key]: { status: 'failed', url: null } }))
        })
    }
    return () => { cancelled = true }
    // refKey encodes exactly the refs; refs itself changes identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey])

  const items = useMemo(
    () => refs.map((r) => ({ ...r, ...(resolved[r.key] || { status: 'loading', url: null }) })),
    [refs, resolved],
  )

  const state = galleryState(inspection, refs)
  const summary = gallerySummary(items)
  const notice = galleryNotice(state, summary)
  const groups = groupPhotos(items)

  // Escape is handled inside the lightbox, but a drawer above us also listens
  // for it. Closing the photo first is the behaviour a reader expects.
  const closeLightbox = useCallback(() => setOpenIndex(null), [])

  if (state === 'unknown') return null

  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <Camera className="w-3.5 h-3.5" /> {title}
        {summary.total > 0 && <span style={{ color: 'var(--text-dim)' }}>({summary.total})</span>}
      </h3>

      {notice && (
        <p className="text-sm mb-3" style={{ color: state === 'none' ? 'var(--text-secondary)' : '#b45309' }}>
          {notice}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key} className="mb-4">
          <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
            {g.title}
          </div>
          <div className="flex flex-wrap gap-3">
            {g.items.map((it) => (
              <PhotoTile
                key={it.key}
                item={it}
                onOpen={() => setOpenIndex(items.findIndex((x) => x.key === it.key))}
              />
            ))}
          </div>
        </div>
      ))}

      {showEvidence && inspection && <EvidenceBlock row={inspection} />}

      {openIndex != null && items[openIndex] && (
        <PhotoLightbox
          items={items}
          index={openIndex}
          onIndex={setOpenIndex}
          onClose={closeLightbox}
        />
      )}
    </div>
  )
}
