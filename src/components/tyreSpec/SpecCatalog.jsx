/**
 * Tyre Specifications catalogue blocks on the Command Center kit: the spec
 * card grid, the table view, the selected-spec detail with its six tabs, and
 * the Tread pattern / Technical drawing cards.
 *
 * Everything shown comes from a stored `tyre_specifications` column, from the
 * shared ISO tables (load index to kg, speed symbol to km/h) or from size-code
 * arithmetic. Pattern, tube type, dual load, weight, images, documents and an
 * approval state are not stored for a specification, so they read "Not
 * recorded" instead of an invented value.
 */
import { useState } from 'react'
import { Edit2, Copy, Trash2, Truck, FileText, ImageOff } from 'lucide-react'
import { Card, KitTable, Tabs, fmtInt } from '../commandCenter/kit'
import { brandMeta } from '../../lib/tyreSpecCatalog'
import {
  specCard, loadLabel, speedLabel, usageStatus, sizeDimensions, historyFor,
} from '../../lib/tyreSpecView'

const NR = <span className="cc-na">Not recorded</span>
const NA = <span className="cc-na">N/A</span>

/** Neutral tyre glyph (illustration only, not a product photo). */
export function TyreGlyph({ size = 56 }) {
  const lugs = Array.from({ length: 16 }, (_, i) => i * 22.5)
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="ts-glyph">
      <circle cx="50" cy="50" r="46" className="ts-glyph-tyre" />
      {lugs.map((a) => (
        <rect key={a} x="47" y="4" width="6" height="11" rx="1.5" className="ts-glyph-lug" transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="26" className="ts-glyph-rim" />
      <circle cx="50" cy="50" r="8" className="ts-glyph-hub" />
    </svg>
  )
}

function StatusPill({ usage }) {
  const st = usageStatus(usage)
  return <span className={`cc-pill ${st.tone}`} title="Derived from the fitted tyres this rule covers">{st.label}</span>
}

function Chips({ items, max = 3 }) {
  if (!items?.length) return NA
  const shown = items.slice(0, max)
  return (
    <span className="ts-chips">
      {shown.map((x) => <span key={x} className="ts-chip">{x}</span>)}
      {items.length > max && <span className="ts-chip muted">+{items.length - max}</span>}
    </span>
  )
}

export function SpecGrid({ rows, usage, selectedId, onSelect }) {
  return (
    <div className="ts-grid">
      {rows.map((s) => {
        const c = specCard(s)
        return (
          <button
            key={s.id} type="button" className="cc-card ts-spec-card"
            aria-pressed={selectedId === s.id} onClick={() => onSelect(s.id)}
          >
            <div className="ts-spec-top">
              <TyreGlyph size={52} />
              <div className="ts-spec-id">
                <span className="ts-spec-brand">{c.brands[0] || 'No brand'}{c.brands.length > 1 ? ` +${c.brands.length - 1}` : ''}</span>
                <b>{c.title}</b>
                <small>{c.position || 'No position'}</small>
              </div>
            </div>
            <StatusPill usage={usage.get(s.id)} />
            <dl className="ts-spec-rows">
              <div><dt>Size</dt><dd>{c.sizes.length ? c.sizes.join(', ') : 'N/A'}</dd></div>
              <div><dt>Pattern</dt><dd className="cc-na">Not recorded</dd></div>
              <div><dt>Type</dt><dd>{c.tyreType}</dd></div>
              <div><dt>Load index</dt><dd>{loadLabel(c)}</dd></div>
              <div><dt>Speed rating</dt><dd>{speedLabel(c)}</dd></div>
            </dl>
            <div className="ts-spec-apps">
              <span title="Application (vehicle type)"><Truck size={13} aria-hidden="true" /> {c.title}</span>
              {c.ply && <span title="Ply rating">{c.ply}</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function specTableColumns(usage) {
  return [
    { key: 'vehicle_type', header: 'Application', cell: (s) => <b className="ts-strong">{s.vehicle_type || 'N/A'}</b> },
    { key: 'position', header: 'Position', cell: (s) => s.position || NA },
    { key: 'sizes', header: 'Sizes', cell: (s) => <Chips items={s.approved_sizes} /> },
    { key: 'brands', header: 'Brands', cell: (s) => <Chips items={s.approved_brands} /> },
    { key: 'load', header: 'Load index', cell: (s) => loadLabel(specCard(s)) },
    { key: 'speed', header: 'Speed rating', cell: (s) => speedLabel(specCard(s)) },
    { key: 'ply_rating', header: 'Ply', cell: (s) => s.ply_rating || NA },
    { key: 'status', header: 'In service', cell: (s) => <StatusPill usage={usage.get(s.id)} /> },
    { key: 'fitted', header: 'Fitted tyres', align: 'right', cell: (s) => fmtInt(usage.get(s.id)?.fitted ?? 0) },
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

const fmtMm = (n) => (n == null ? 'N/A' : `${fmtInt(n)} mm`)

export function SpecDetail({ spec, usage, history, isAdmin, onEdit, onDuplicate, onDelete, onOpenPolicy }) {
  const [tab, setTab] = useState('details')
  const c = specCard(spec)
  const u = usage.get(spec.id)
  const firstDims = c.sizes.map(sizeDimensions).find(Boolean) || null
  const hist = historyFor(spec, history)

  return (
    <Card
      title={<span>{c.title} <span className="ts-muted">{c.position}</span></span>}
      sub={`${c.brands.length} approved brand${c.brands.length === 1 ? '' : 's'}, ${c.sizes.length} approved size${c.sizes.length === 1 ? '' : 's'}`}
      action={isAdmin ? (
        <div className="ts-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => onEdit(spec)}><Edit2 size={14} aria-hidden="true" /> Edit</button>
          <button type="button" className="cc-btn-ghost" onClick={() => onDuplicate(spec)}><Copy size={14} aria-hidden="true" /> Duplicate</button>
          <button type="button" className="cc-icon-btn" aria-label="Delete specification" title="Delete specification" onClick={() => onDelete(spec)}><Trash2 size={14} /></button>
        </div>
      ) : <span className="ts-muted">Admin access required to edit</span>}
    >
      <Tabs variant="line" label="Specification detail" value={tab} onChange={setTab} tabs={DETAIL_TABS} />

      {tab === 'details' && (
        <dl className="ts-details">
          <Field label="Brand">{c.brands.length ? c.brands.join(', ') : NA}</Field>
          <Field label="Pattern">{NR}</Field>
          <Field label="Size">{c.sizes.length ? c.sizes.join(', ') : NA}</Field>
          <Field label="Type">{c.tyreType} ({c.position || 'no position'})</Field>
          <Field label="Load index">{loadLabel(c)}</Field>
          <Field label="Speed rating">{speedLabel(c)}</Field>
          <Field label="Ply rating">{c.ply || NA}</Field>
          <Field label="TT / TL">{NR}</Field>
          <Field label="Tread depth (new)">{NR}</Field>
          <Field label="Minimum tread depth">{c.tread != null ? `${c.tread} mm` : NA}</Field>
          <Field label="Overall diameter">{firstDims ? `${fmtMm(firstDims.overallDiameter)} nominal` : NA}</Field>
          <Field label="Section width">{firstDims ? `${fmtMm(firstDims.sectionWidth)} nominal` : NA}</Field>
          <Field label="Rim diameter">{firstDims ? `${firstDims.rimInch} in` : NA}</Field>
          <Field label="Max load (single)">{c.loadKg != null ? `${fmtInt(c.loadKg)} kg` : NA}</Field>
          <Field label="Max load (dual)">{NR}</Field>
          <Field label="Inflation (recommended)">{c.pressure != null ? `${c.pressure} psi` : NA}</Field>
          <Field label="Inflation (dual)">{NR}</Field>
          <Field label="Weight">{NR}</Field>
          <Field label="Application">{c.title}</Field>
          <Field label="Suitable for">{c.position || NA}</Field>
          <Field label="Notes" wide>{c.notes || NA}</Field>
        </dl>
      )}

      {tab === 'app' && (
        <div className="ts-stack">
          <dl className="ts-details">
            <Field label="Vehicle type">{c.title}</Field>
            <Field label="Position">{c.position || NA}</Field>
            <Field label="Fitted tyres covered">{fmtInt(u?.fitted ?? 0)}</Field>
            <Field label="Conforming">{fmtInt(u?.conforming ?? 0)}</Field>
            <Field label="Out of spec">{fmtInt(u?.nonConforming ?? 0)}</Field>
            <Field label="Approved sizes">{c.sizes.length ? c.sizes.join(', ') : NA}</Field>
          </dl>
          <p className="ts-note">Brand reference data below comes from the shared brand catalogue, not from this record.</p>
          <KitTable
            compact
            rows={c.brands.map((b) => ({ brand: b, ...brandMeta(b) }))}
            getRowId={(r) => r.brand}
            empty="No approved brands on this rule."
            columns={[
              { key: 'brand', header: 'Brand', cell: (r) => <b className="ts-strong">{r.brand}</b> },
              { key: 'tier', header: 'Tier', cell: (r) => (r.tier && r.tier !== 'unknown' ? r.tier : NA) },
              { key: 'origin', header: 'Origin', cell: (r) => r.origin || NA },
              { key: 'retreadable', header: 'Retreadable', cell: (r) => (r.tier === 'unknown' ? NA : r.retreadable ? 'Yes' : 'No') },
              { key: 'application', header: 'Typical use', cell: (r) => (r.application?.length ? r.application.join(', ') : NA) },
            ]}
          />
        </div>
      )}

      {tab === 'tread' && (
        <div className="ts-stack">
          <dl className="ts-details">
            <Field label="Minimum tread depth">{c.tread != null ? `${c.tread} mm` : NA}</Field>
            <Field label="Recommended pressure">{c.pressure != null ? `${c.pressure} psi` : NA}</Field>
            <Field label="Speed rating">{speedLabel(c)}</Field>
            <Field label="Load index">{loadLabel(c)}</Field>
            <Field label="Tread pattern">{NR}</Field>
            <Field label="Fitted tyres out of spec">{fmtInt(u?.nonConforming ?? 0)}</Field>
          </dl>
          <p className="ts-note">Durability and price indices are catalogue ratings (0 to 100), not fleet measurements. Measured cost per km lives in the Value advisor tab.</p>
          <KitTable
            compact
            rows={c.brands.map((b) => ({ brand: b, ...brandMeta(b) }))}
            getRowId={(r) => r.brand}
            empty="No approved brands on this rule."
            columns={[
              { key: 'brand', header: 'Brand', cell: (r) => <b className="ts-strong">{r.brand}</b> },
              { key: 'durabilityIndex', header: 'Durability index', align: 'right', cell: (r) => (r.durabilityIndex ?? NA) },
              { key: 'priceIndex', header: 'Price index', align: 'right', cell: (r) => (r.priceIndex ?? NA) },
              { key: 'casing', header: 'Casing', cell: (r) => (r.casing && r.casing !== 'unknown' ? r.casing : NA) },
            ]}
          />
        </div>
      )}

      {tab === 'dims' && (
        <div className="ts-stack">
          <p className="ts-note">Nominal values worked out from each metric size code (width, aspect ratio, rim). Sizes without an aspect ratio, such as 23.5R25, have none.</p>
          <KitTable
            compact
            rows={c.sizes.map((z) => ({ size: z, d: sizeDimensions(z) }))}
            getRowId={(r) => r.size}
            empty="No approved sizes on this rule."
            columns={[
              { key: 'size', header: 'Size', cell: (r) => <b className="ts-strong">{r.size}</b> },
              { key: 'w', header: 'Section width', align: 'right', cell: (r) => (r.d ? fmtMm(r.d.sectionWidth) : NA) },
              { key: 'a', header: 'Aspect ratio', align: 'right', cell: (r) => (r.d ? `${r.d.aspect}%` : NA) },
              { key: 's', header: 'Sidewall height', align: 'right', cell: (r) => (r.d ? fmtMm(r.d.sidewall) : NA) },
              { key: 'r', header: 'Rim diameter', align: 'right', cell: (r) => (r.d ? `${r.d.rimInch} in` : NA) },
              { key: 'o', header: 'Overall diameter', align: 'right', cell: (r) => (r.d ? fmtMm(r.d.overallDiameter) : NA) },
            ]}
          />
        </div>
      )}

      {tab === 'docs' && (
        <div className="cc-empty">
          <div>
            <FileText size={22} aria-hidden="true" /><br />
            No documents are stored against a specification.<br />
            The signed fitment policy covering every rule is produced from the Fitment policy tab.
            <br /><button type="button" className="cc-btn" onClick={onOpenPolicy}>Open fitment policy</button>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="ts-stack">
          <p className="ts-note">Changes made in this session. Specification history is not stored in the database, and there is no pending or rejected approval state for a rule: a saved rule is the approved fitment.</p>
          <KitTable
            compact
            rows={hist}
            getRowId={(r) => String(r.id)}
            empty="No changes to this rule in this session."
            columns={[
              { key: 'date', header: 'When', cell: (r) => new Date(r.date).toLocaleString() },
              { key: 'action', header: 'Action' },
              { key: 'changed_field', header: 'Field', cell: (r) => r.changed_field || NA },
            ]}
          />
        </div>
      )}
    </Card>
  )
}

export function TreadPatternCard() {
  return (
    <Card title="Tread pattern">
      <div className="cc-empty">
        <div><ImageOff size={22} aria-hidden="true" /><br />No tread pattern image is stored for specifications.</div>
      </div>
    </Card>
  )
}

/** Side profile drawn to scale from the first metric size on the rule. */
export function TechnicalDrawingCard({ spec }) {
  const d = spec ? (spec.approved_sizes || []).map(sizeDimensions).find(Boolean) : null
  return (
    <Card title="Technical drawing" sub={d ? `${d.size}, nominal from the size code` : undefined}>
      {!d ? (
        <div className="cc-empty">{spec ? 'N/A: no metric size (width/aspect R rim) on this rule to draw from.' : 'Select a specification to draw it.'}</div>
      ) : (() => {
        const H = 150; const scale = H / d.overallDiameter
        const od = d.overallDiameter * scale; const rim = d.rimDiameter * scale; const w = d.sectionWidth * scale
        const cx = 80; const cy = 102; const bx = 190
        return (
          <svg viewBox="0 0 300 210" className="ts-drawing" role="img"
            aria-label={`Overall diameter ${d.overallDiameter} millimetres, section width ${d.sectionWidth} millimetres, rim ${d.rimInch} inches`}>
            <circle cx={cx} cy={cy} r={od / 2} className="ts-draw-tyre" />
            <circle cx={cx} cy={cy} r={rim / 2} className="ts-draw-rim" />
            <line x1={cx - od / 2} y1={cy + od / 2 + 12} x2={cx + od / 2} y2={cy + od / 2 + 12} className="ts-draw-dim" />
            <text x={cx} y={cy + od / 2 + 24} textAnchor="middle" className="ts-draw-text">{d.overallDiameter} mm</text>
            <rect x={bx} y={cy - od / 2} width={w} height={od} rx={w / 4} className="ts-draw-tyre" />
            <rect x={bx - 2} y={cy - rim / 2} width={w + 4} height={rim} className="ts-draw-rim" />
            <line x1={bx} y1={cy - od / 2 - 8} x2={bx + w} y2={cy - od / 2 - 8} className="ts-draw-dim" />
            <text x={bx + w / 2} y={cy - od / 2 - 12} textAnchor="middle" className="ts-draw-text">{d.sectionWidth} mm</text>
            <text x={bx + w + 8} y={cy + 4} className="ts-draw-text">rim {d.rimInch} in</text>
          </svg>
        )
      })()}
    </Card>
  )
}
