/**
 * Tyre specification CATALOGUE blocks (table `tyre_spec_catalog`): card grid,
 * table columns, the selected spec detail with six tabs (approval history is
 * read from `tyre_spec_catalog_events`), the tread pattern card (first stored
 * image) and the technical drawing (recorded dimensions, else nominal from the
 * size code, labelled which).
 *
 * Every value is a stored column or ISO lookup (load index to kg, speed rating
 * to km/h). A blank column reads "Not recorded", never an invented value.
 */
import { useEffect, useState } from 'react'
import {
  Edit2, Copy, Trash2, Truck, FileText, ImageOff, CheckCircle2, XCircle, RotateCcw, ExternalLink,
} from 'lucide-react'
import { Card, CardState, KitTable, Tabs, fmtInt } from '../commandCenter/kit'
import { brandMeta } from '../../lib/tyreSpecCatalog'
import {
  approvalMeta, catalogTypeLabel, catalogLoadLabel, catalogSpeedLabel, catalogDimensions,
} from '../../lib/tyreSpecView'
import { listCatalogEvents, fileRef } from '../../lib/api/tyreSpecCatalog'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { toUserMessage } from '../../lib/safeError'
import { safeHref } from '../../lib/safeUrl'
import Modal from '../ui/Modal'
import { TyreGlyph } from './SpecCatalog'

const NR = <span className="cc-na">Not recorded</span>
const has = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
const val = (v, suffix = '') => (has(v) ? `${typeof v === 'number' ? fmtInt(v) : v}${suffix}` : NR)

/** Resolve a stored file entry to a short-lived signed URL. */
export function useSignedUrl(entry) {
  const ref = fileRef(entry)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (ref) resolveStorageUrl(ref).then((u) => { if (live) setUrl(u) }).catch(() => {})
    return () => { live = false }
  }, [ref])
  return url
}

export function ApprovalPill({ status }) {
  const m = approvalMeta(status)
  return <span className={`cc-pill ${m.tone}`}>{m.label}</span>
}

function CardThumb({ row }) {
  const url = useSignedUrl((row.images || [])[0])
  return url
    ? <img src={url} alt={`${row.brand} ${row.pattern}`} className="ts-thumb" width={52} height={52} />
    : <TyreGlyph size={52} />
}

export function CatalogGrid({ rows, selectedId, onSelect }) {
  return (
    <div className="ts-grid">
      {rows.map((r) => (
        <button key={r.id} type="button" className="cc-card ts-spec-card" aria-pressed={selectedId === r.id} onClick={() => onSelect(r.id)}>
          <div className="ts-spec-top">
            <CardThumb row={r} />
            <div className="ts-spec-id">
              <span className="ts-spec-brand">{r.brand}</span>
              <b>{r.pattern}</b>
              <small>{r.size}</small>
            </div>
          </div>
          <ApprovalPill status={r.approval_status} />
          <dl className="ts-spec-rows">
            <div><dt>Size</dt><dd>{r.size}</dd></div>
            <div><dt>Pattern</dt><dd>{r.pattern}</dd></div>
            <div><dt>Type</dt><dd>{catalogTypeLabel(r.tyre_type) || 'Not recorded'}</dd></div>
            <div><dt>Load index</dt><dd>{catalogLoadLabel(r)}</dd></div>
            <div><dt>Speed rating</dt><dd>{catalogSpeedLabel(r)}</dd></div>
          </dl>
          <div className="ts-spec-apps">
            <span title="Application"><Truck size={13} aria-hidden="true" /> {r.application || 'No application recorded'}</span>
            {r.ply_rating && <span title="Ply rating">{r.ply_rating}</span>}
          </div>
        </button>
      ))}
    </div>
  )
}

export function catalogTableColumns() {
  return [
    { key: 'brand', header: 'Brand', cell: (r) => <b className="ts-strong">{r.brand}</b> },
    { key: 'pattern', header: 'Pattern', cell: (r) => r.pattern },
    { key: 'size', header: 'Size', cell: (r) => r.size },
    { key: 'type', header: 'Type', cell: (r) => catalogTypeLabel(r.tyre_type) || NR },
    { key: 'load', header: 'Load index', cell: (r) => catalogLoadLabel(r) },
    { key: 'speed', header: 'Speed rating', cell: (r) => catalogSpeedLabel(r) },
    { key: 'ply', header: 'Ply', cell: (r) => r.ply_rating || NR },
    { key: 'application', header: 'Application', cell: (r) => r.application || NR },
    { key: 'status', header: 'Status', cell: (r) => <ApprovalPill status={r.approval_status} /> },
  ]
}

const DETAIL_TABS = [
  { key: 'details', label: 'Specification details' },
  { key: 'app', label: 'Application & compatibility' },
  { key: 'tread', label: 'Tread & performance' },
  { key: 'dims', label: 'Dimensions' },
  { key: 'docs', label: 'Documents' },
  { key: 'history', label: 'Approval history' },
]

function Field({ label, children, wide }) {
  return <div className={wide ? 'ts-wide' : undefined}><dt>{label}</dt><dd>{children}</dd></div>
}

const STATUS_WORD = { approved: 'Approved', pending: 'Pending', not_approved: 'Not approved' }
const ACTION_WORD = { created: 'Created', status_changed: 'Status changed', edited: 'Edited' }

function FileLink({ entry }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function open() {
    setBusy(true); setErr('')
    try {
      const url = await resolveStorageUrl(fileRef(entry))
      if (!url) throw new Error('The file could not be opened.')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setErr(toUserMessage(e, 'The file could not be opened.'))
    } finally { setBusy(false) }
  }
  return (
    <span>
      <button type="button" className="cc-link cc-link-btn" onClick={open} disabled={busy}>
        <ExternalLink size={12} aria-hidden="true" /> {entry.name || 'File'}
      </button>
      {err && <span className="ts-err"> {err}</span>}
    </span>
  )
}

function SourceLink({ url }) {
  const href = safeHref(url)
  if (!href) return <span className="cc-na">Not recorded</span>
  return <a className="cc-link ts-source" href={href} target="_blank" rel="noopener noreferrer">{href}</a>
}

export function CatalogDetail({ spec, canEdit, canApprove, canDelete, busy, onEdit, onDuplicate, onDelete, onSetStatus, reloadKey }) {
  const [tab, setTab] = useState('details')
  const [events, setEvents] = useState({ loading: false, data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const dims = catalogDimensions(spec)

  useEffect(() => {
    if (tab !== 'history') return undefined
    let live = true
    setEvents({ loading: true, data: null, error: null })
    listCatalogEvents(spec.id)
      .then((d) => { if (live) setEvents({ loading: false, data: d, error: null }) })
      .catch((e) => { if (live) setEvents({ loading: false, data: null, error: toUserMessage(e, 'Could not load the approval history.') }) })
    return () => { live = false }
  }, [tab, spec.id, reloadKey, attempt])

  const retryEvents = () => setAttempt((n) => n + 1)
  const brandRef = brandMeta(spec.brand)
  const files = [...(spec.images || []).map((f) => ({ ...f, kind: 'Image' })), ...(spec.documents || []).map((f) => ({ ...f, kind: 'Document' }))]

  return (
    <Card
      title={<span>{spec.brand} {spec.pattern} <span className="ts-muted">{spec.size}</span></span>}
      sub={<span><ApprovalPill status={spec.approval_status} />{spec.approved_at ? ` since ${new Date(spec.approved_at).toLocaleDateString()}` : ''}</span>}
      action={(
        <div className="ts-actions">
          {canApprove && spec.approval_status !== 'approved' && (
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => onSetStatus(spec, 'approved')}><CheckCircle2 size={14} aria-hidden="true" /> Approve</button>
          )}
          {canApprove && spec.approval_status !== 'not_approved' && (
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={() => onSetStatus(spec, 'not_approved')}><XCircle size={14} aria-hidden="true" /> Reject</button>
          )}
          {canApprove && spec.approval_status !== 'pending' && (
            <button type="button" className="cc-icon-btn" disabled={busy} aria-label="Return to pending" title="Return to pending" onClick={() => onSetStatus(spec, 'pending')}><RotateCcw size={14} /></button>
          )}
          {canEdit && <button type="button" className="cc-btn-ghost" onClick={() => onEdit(spec)}><Edit2 size={14} aria-hidden="true" /> Edit</button>}
          <button type="button" className="cc-btn-ghost" onClick={() => onDuplicate(spec)}><Copy size={14} aria-hidden="true" /> Duplicate</button>
          {canDelete && <button type="button" className="cc-icon-btn" aria-label="Delete specification" title="Delete specification" onClick={() => onDelete(spec)}><Trash2 size={14} /></button>}
        </div>
      )}
    >
      <Tabs variant="line" label="Specification detail" value={tab} onChange={setTab} tabs={DETAIL_TABS} />

      {tab === 'details' && (
        <dl className="ts-details">
          <Field label="Brand">{spec.brand}</Field>
          <Field label="Pattern">{spec.pattern}</Field>
          <Field label="Size">{spec.size}</Field>
          <Field label="Type">{catalogTypeLabel(spec.tyre_type) || NR}</Field>
          <Field label="Load index (single/dual)">{catalogLoadLabel(spec)}</Field>
          <Field label="Speed rating">{catalogSpeedLabel(spec)}</Field>
          <Field label="Ply rating">{val(spec.ply_rating)}</Field>
          <Field label="TT / TL">{spec.tube_type === 'tube' ? 'TT (tube type)' : spec.tube_type === 'tubeless' ? 'TL (tubeless)' : NR}</Field>
          <Field label="Tread depth (new)">{val(spec.tread_depth_new_mm, ' mm')}</Field>
          <Field label="Minimum tread depth">{val(spec.tread_depth_min_mm, ' mm')}</Field>
          <Field label="Overall diameter">{val(spec.overall_diameter_mm, ' mm')}</Field>
          <Field label="Section width">{val(spec.section_width_mm, ' mm')}</Field>
          <Field label="Recommended rim">{val(spec.recommended_rim)}</Field>
          <Field label="Max load (single)">{val(spec.max_load_single_kg, ' kg')}</Field>
          <Field label="Max load (dual)">{val(spec.max_load_dual_kg, ' kg')}</Field>
          <Field label="Inflation (single)">{val(spec.inflation_single_kpa, ' kPa')}</Field>
          <Field label="Inflation (dual)">{val(spec.inflation_dual_kpa, ' kPa')}</Field>
          <Field label="Weight">{val(spec.weight_kg, ' kg')}</Field>
          <Field label="Application">{val(spec.application)}</Field>
          <Field label="Suitable for">{spec.suitable_for?.length ? spec.suitable_for.join(', ') : NR}</Field>
          <Field label="Description" wide>{val(spec.description)}</Field>
          <Field label="Source" wide><SourceLink url={spec.source_url} /></Field>
          {spec.source_note && <Field label="Source note" wide>{spec.source_note}</Field>}
        </dl>
      )}

      {tab === 'app' && (
        <dl className="ts-details">
          <Field label="Application">{val(spec.application)}</Field>
          <Field label="Suitable for" wide>{spec.suitable_for?.length ? spec.suitable_for.join(', ') : NR}</Field>
          <Field label="Recommended rim">{val(spec.recommended_rim)}</Field>
          <Field label="Country">{spec.country || 'All countries'}</Field>
          <Field label="Brand tier (brand catalogue)">{brandRef.tier && brandRef.tier !== 'unknown' ? brandRef.tier : NR}</Field>
          <Field label="Brand origin (brand catalogue)">{brandRef.origin || NR}</Field>
          <Field label="Retreadable (brand catalogue)">{brandRef.tier === 'unknown' ? NR : brandRef.retreadable ? 'Yes' : 'No'}</Field>
        </dl>
      )}

      {tab === 'tread' && (
        <dl className="ts-details">
          <Field label="Tread pattern">{spec.pattern}</Field>
          <Field label="Tread depth (new)">{val(spec.tread_depth_new_mm, ' mm')}</Field>
          <Field label="Minimum tread depth">{val(spec.tread_depth_min_mm, ' mm')}</Field>
          <Field label="Usable tread">{has(spec.tread_depth_new_mm) && has(spec.tread_depth_min_mm)
            ? `${Math.max(0, Number(spec.tread_depth_new_mm) - Number(spec.tread_depth_min_mm)).toFixed(1)} mm` : NR}</Field>
          <Field label="Speed rating">{catalogSpeedLabel(spec)}</Field>
          <Field label="Load index">{catalogLoadLabel(spec)}</Field>
        </dl>
      )}

      {tab === 'dims' && (
        <dl className="ts-details">
          <Field label="Width">{val(spec.width_mm, ' mm')}</Field>
          <Field label="Aspect ratio">{val(spec.aspect_ratio, '%')}</Field>
          <Field label="Rim">{val(spec.rim_in, ' in')}</Field>
          <Field label="Overall diameter">{has(spec.overall_diameter_mm) ? `${fmtInt(spec.overall_diameter_mm)} mm` : dims ? `${fmtInt(dims.overallDiameter)} mm nominal` : NR}</Field>
          <Field label="Section width">{has(spec.section_width_mm) ? `${fmtInt(spec.section_width_mm)} mm` : dims ? `${fmtInt(dims.sectionWidth)} mm nominal` : NR}</Field>
          <Field label="Weight">{val(spec.weight_kg, ' kg')}</Field>
        </dl>
      )}

      {tab === 'docs' && (
        files.length ? (
          <KitTable compact rows={files} getRowId={(f) => f.path} columns={[
            { key: 'name', header: 'File', cell: (f) => <FileLink entry={f} /> },
            { key: 'kind', header: 'Kind', cell: (f) => f.kind },
            { key: 'size', header: 'Size', align: 'right', cell: (f) => (f.size ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : 'N/A') },
            { key: 'at', header: 'Uploaded', cell: (f) => (f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString() : 'N/A') },
          ]} />
        ) : (
          <div className="cc-empty"><div><FileText size={22} aria-hidden="true" /><br />No images or documents are attached to this specification yet.</div></div>
        )
      )}

      {tab === 'history' && (
        <CardState state={{ ...events, retry: retryEvents }} lines={3}
          empty={events.data && events.data.length === 0 ? 'No approval history is recorded for this specification.' : null}>
          <KitTable compact rows={events.data || []} getRowId={(r) => String(r.id)} columns={[
            { key: 'at', header: 'When', cell: (r) => new Date(r.at).toLocaleString() },
            { key: 'action', header: 'Action', cell: (r) => ACTION_WORD[r.action] || r.action },
            { key: 'status', header: 'Status', cell: (r) => (r.from_status ? `${STATUS_WORD[r.from_status] || r.from_status} to ${STATUS_WORD[r.to_status] || r.to_status}` : STATUS_WORD[r.to_status] || 'N/A') },
            { key: 'actor', header: 'By', cell: (r) => r.actor_name || 'Not recorded' },
            { key: 'note', header: 'Note', cell: (r) => r.note || '' },
          ]} />
        </CardState>
      )}
    </Card>
  )
}

export function CatalogTreadCard({ spec }) {
  const first = (spec?.images || [])[0]
  const url = useSignedUrl(first)
  return (
    <Card title="Tread pattern" sub={spec ? `${spec.brand} ${spec.pattern}` : undefined}>
      {first && url ? (
        <img src={url} alt={`Tread pattern of ${spec.brand} ${spec.pattern}`} className="ts-tread-img" />
      ) : (
        <div className="cc-empty"><div><ImageOff size={22} aria-hidden="true" /><br />
          {!spec ? 'Select a specification to see its tread image.' : first ? 'Loading image...' : 'No image is attached to this specification.'}
        </div></div>
      )}
    </Card>
  )
}

/** Side profile to scale: recorded dimensions, else nominal from the size code. */
export function CatalogDrawingCard({ spec }) {
  const d = catalogDimensions(spec)
  return (
    <Card title="Technical drawing" sub={d ? `${d.size}, ${d.source === 'recorded' ? 'recorded dimensions' : 'nominal from the size code'}` : undefined}>
      {!d ? (
        <div className="cc-empty">{spec ? 'N/A: no recorded dimensions and no metric size (width/aspect R rim) to draw from.' : 'Select a specification to draw it.'}</div>
      ) : (() => {
        const H = 150; const scale = H / d.overallDiameter
        const od = d.overallDiameter * scale; const rim = Math.min(d.rimDiameter * scale, od * 0.95); const w = d.sectionWidth * scale
        const cx = 80; const cy = 102; const bx = 190
        return (
          <svg viewBox="0 0 300 210" className="ts-drawing" role="img"
            aria-label={`Overall diameter ${d.overallDiameter} millimetres, section width ${d.sectionWidth} millimetres, rim ${d.rimInch} inches`}>
            <circle cx={cx} cy={cy} r={od / 2} className="ts-draw-tyre" />
            <circle cx={cx} cy={cy} r={rim / 2} className="ts-draw-rim" />
            <line x1={cx - od / 2} y1={cy + od / 2 + 12} x2={cx + od / 2} y2={cy + od / 2 + 12} className="ts-draw-dim" />
            <text x={cx} y={cy + od / 2 + 24} textAnchor="middle" className="ts-draw-text">{fmtInt(d.overallDiameter)} mm</text>
            <rect x={bx} y={cy - od / 2} width={w} height={od} rx={w / 4} className="ts-draw-tyre" />
            <rect x={bx - 2} y={cy - rim / 2} width={w + 4} height={rim} className="ts-draw-rim" />
            <line x1={bx} y1={cy - od / 2 - 8} x2={bx + w} y2={cy - od / 2 - 8} className="ts-draw-dim" />
            <text x={bx + w / 2} y={cy - od / 2 - 12} textAnchor="middle" className="ts-draw-text">{fmtInt(d.sectionWidth)} mm</text>
            <text x={bx + w + 8} y={cy + 4} className="ts-draw-text">rim {d.rimInch} in</text>
          </svg>
        )
      })()}
    </Card>
  )
}

export function CatalogDeleteModal({ spec, busy, onClose, onConfirm }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Delete specification"
      footer={(
        <>
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cc-btn-primary" onClick={onConfirm} disabled={busy}><Trash2 size={14} aria-hidden="true" /> {busy ? 'Deleting...' : 'Delete'}</button>
        </>
      )}
    >
      <p className="ts-note">
        Delete {spec.brand} {spec.pattern} {spec.size} from the catalogue? Its approval history is removed with it.
        Attached files stay in storage.
      </p>
    </Modal>
  )
}
