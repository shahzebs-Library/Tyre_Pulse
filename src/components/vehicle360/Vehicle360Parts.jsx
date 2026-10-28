/**
 * Presentational parts of the redesigned Vehicle 360 page, built on the Command
 * Center kit. Nothing here fetches: the page passes already-loaded rows and the
 * shapes from src/lib/vehicle360View.js. A value with no source renders N/A and
 * says why; no figure is invented.
 */
import { Link } from 'react-router-dom'
import {
  Camera, Loader2, Pencil, Wrench, ClipboardCheck, Plus, Maximize2,
  CircleDot, Activity, AlertTriangle, DollarSign, Save, X,
} from 'lucide-react'
import { Card, CardState, ViewAll, Donut, VehicleThumb, fmtInt } from '../commandCenter/kit'
import VehicleTyreDiagram from '../VehicleTyreDiagram'
import { diagramPositions, relativeDay, COST_PERIODS } from '../../lib/vehicle360View'
import { vehicleTypeIsKnown } from '../../lib/tyreBay'

const NA = <span className="cc-na">N/A</span>
export const val = (v) => (v == null || v === '' ? NA : v)

export function statusTone(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'active') return 'good'
  if (!s) return 'muted'
  if (s === 'inactive' || s === 'retired' || s === 'transferred') return 'muted'
  return 'info'
}

/** KPI tile with a sub line and an optional chip (the kit Kpi has neither). */
export function Tile({ icon: Icon, tone, value, label, sub, chip, loading }) {
  return (
    <div className="cc-card cc-kpi v360-kpi">
      <span className={`cc-kpi-icon ${tone}`}><Icon size={21} aria-hidden="true" /></span>
      <div className="cc-kpi-body">
        <div className="cc-kpi-val">{loading ? '...' : value}</div>
        <div className="cc-kpi-label">{label}</div>
        {sub && <div className="v360-kpi-sub">{sub}</div>}
      </div>
      {chip}
    </div>
  )
}

export function Breadcrumb({ asset }) {
  return (
    <nav className="v360-crumb" aria-label="Breadcrumb">
      <Link to="/fleet-master">Fleet</Link><span aria-hidden="true">/</span>
      <Link to="/fleet-master">Vehicles</Link><span aria-hidden="true">/</span>
      <span aria-current="page">{asset}</span>
    </nav>
  )
}

/** Header: photo with Change photo, identity, four read-only tiles, spec strip. */
export function HeaderCard({ vehicle, fleet, photoUrl, uploading, fileRef, onPhoto, actions }) {
  const facts = [
    ['Asset No', vehicle.asset_no],
    ['Vehicle Type', vehicle.vehicle_type],
    ['Site', vehicle.site],
    ['Region', vehicle.region],
  ]
  const model = fleet?.model_year ?? vehicle.year
  const strip = [
    ['Make', vehicle.make], ['Model', vehicle.model], ['Year', model],
    ['Plate', fleet?.registration_no], ['VIN / Chassis', fleet?.chassis_no],
  ]
  return (
    <section className="cc-card v360-head" aria-label="Vehicle summary">
      <div className="v360-photo">
        <VehicleThumb row={vehicle} src={photoUrl} size="lg" />
        <button type="button" className="v360-photo-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Camera size={14} aria-hidden="true" />}
          {photoUrl ? 'Change photo' : 'Add photo'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="v360-file" aria-label="Upload vehicle photo" onChange={onPhoto} />
      </div>
      <div className="v360-id">
        <div className="v360-title">
          <h1>{vehicle.asset_no}</h1>
          {vehicle.status && <span className={`cc-pill ${statusTone(vehicle.status)}`}>{vehicle.status}</span>}
        </div>
        <p className="v360-sub">
          {[vehicle.vehicle_type, vehicle.site, vehicle.country].filter(Boolean).join(' | ') || 'No type or site recorded'}
        </p>
        <dl className="v360-facts">
          {facts.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{val(v)}</dd></div>
          ))}
        </dl>
        <dl className="v360-strip">
          {strip.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{val(v)}</dd></div>
          ))}
        </dl>
      </div>
      <div className="v360-actions">{actions}</div>
    </section>
  )
}

/** Vehicle Information card with the inline odometer / engine-hours editor. */
export function InfoCard({ vehicle, fleet, meters, loadingMeters, money, edit, onEdit, onCancel, onSave, saving, draft, setDraft, editLink }) {
  const rows = [
    ['Fleet no', vehicle.fleet_number],
    ['Make / Model', [vehicle.make, vehicle.model].filter(Boolean).join(' ')],
    ['Type', vehicle.vehicle_type],
    ['Tyre size', vehicle.tyre_size],
    ['Department', vehicle.department],
    ['Operator', vehicle.operator_name],
    ['Monthly tyre budget', vehicle.monthly_tyre_budget ? money(Number(vehicle.monthly_tyre_budget)) : null],
    ['Operating status', fleet?.ops_status],
  ]
  const hasFix = vehicle.latitude != null && vehicle.longitude != null && vehicle.latitude !== '' && vehicle.longitude !== ''
  return (
    <Card title="Vehicle Information" action={editLink}>
      <dl className="v360-kv">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{val(v)}</dd></div>)}
        <div>
          <dt>Odometer</dt>
          <dd>
            {edit
              ? <input className="cc-select v360-in" inputMode="decimal" aria-label="Odometer km" value={draft.km} onChange={(e) => setDraft((d) => ({ ...d, km: e.target.value }))} />
              : (loadingMeters ? '...' : meters.currentKm == null ? NA : <>{fmtInt(meters.currentKm)} km{meters.kmDate && <small> at {meters.kmDate}</small>}</>)}
          </dd>
        </div>
        <div>
          <dt>Engine hours</dt>
          <dd>
            {edit
              ? <input className="cc-select v360-in" inputMode="decimal" aria-label="Engine hours" value={draft.hours} onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))} />
              : (loadingMeters ? '...' : meters.engineHours == null ? NA : <>{fmtInt(meters.engineHours)} h{meters.hoursDate && <small> at {meters.hoursDate}</small>}</>)}
          </dd>
        </div>
        <div><dt>Status</dt><dd>{vehicle.status ? <span className={`cc-pill ${statusTone(vehicle.status)}`}>{vehicle.status}</span> : NA}</dd></div>
        <div>
          <dt>Current location</dt>
          <dd>{hasFix ? `${Number(vehicle.latitude).toFixed(4)}, ${Number(vehicle.longitude).toFixed(4)}` : <>{NA} <small>no GPS fix</small></>}</dd>
        </div>
      </dl>
      <div className="v360-card-foot">
        {edit ? (
          <>
            <button type="button" className="cc-btn-primary" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} Save readings
            </button>
            <button type="button" className="cc-btn-ghost" onClick={onCancel} disabled={saving}><X size={14} aria-hidden="true" /> Cancel</button>
          </>
        ) : (
          <button type="button" className="cc-btn-ghost" onClick={onEdit}><Pencil size={14} aria-hidden="true" /> Update meters</button>
        )}
      </div>
    </Card>
  )
}

const LEGEND = [
  ['normal', 'Normal', 'var(--cc-green)'],
  ['warning', 'Warning', 'var(--cc-amber)'],
  ['critical', 'Critical', 'var(--cc-red)'],
  ['unrated', 'Not rated', 'var(--cc-ink-3)'],
  ['notFitted', 'Not fitted', 'var(--cc-track)'],
]

export function LayoutLegend({ status }) {
  return (
    <ul className="v360-legend" aria-label="Tyre layout legend">
      {LEGEND.map(([k, label, color]) => (
        <li key={k}><i style={{ background: color }} aria-hidden="true" />{label}<b>{status[k] == null ? 'N/A' : status[k]}</b></li>
      ))}
    </ul>
  )
}

/** Wheel diagram + legend. The diagram is drawn only when the layout is known. */
export function LayoutCard({ vehicle, tyres, status, onExpand, wide = false }) {
  const known = vehicleTypeIsKnown(vehicle.vehicle_type)
  return (
    <Card
      title="Tyre Layout"
      action={onExpand && (
        <button type="button" className="cc-icon-btn" onClick={onExpand} aria-label="Open the full tyre layout" title="Open the full tyre layout">
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      )}
    >
      {status.tyreless ? (
        <div className="cc-empty">This equipment carries no tyres, so there is no layout to show.</div>
      ) : !known ? (
        <div className="cc-empty">The vehicle type is not recorded, so the wheel layout is not drawn. Set the type in Fleet Master.</div>
      ) : (
        <>
          <div className="v360-diagram">
            <VehicleTyreDiagram
              vehicleType={vehicle.vehicle_type}
              positions={diagramPositions(vehicle.vehicle_type, tyres)}
              width={wide ? 300 : 200}
            />
          </div>
          <LayoutLegend status={status} />
          {status.unmapped > 0 && (
            <p className="v360-note">{status.unmapped} fitted tyre{status.unmapped === 1 ? '' : 's'} carry a position this layout does not have, so they are not drawn.</p>
          )}
        </>
      )}
    </Card>
  )
}

export function LatestInspectionCard({ loading, error, inspection, startTo, allTo, now }) {
  return (
    <Card title="Latest Inspection" action={<ViewAll to={allTo} />}>
      <CardState state={{ loading, data: loading ? null : {}, error: null }} empty={null}>
        {error ? <div className="cc-empty" role="alert">{error}</div>
          : !inspection ? (
            <div className="cc-empty">
              <div>No inspection is recorded for this vehicle.<br />
                <Link className="cc-btn v360-btn-inline" to={startTo}><ClipboardCheck size={13} aria-hidden="true" /> Start Inspection</Link>
              </div>
            </div>
          ) : (
            <dl className="v360-kv">
              <div><dt>Date</dt><dd>{inspection.day} <small>{relativeDay(inspection.day, now)}</small></dd></div>
              <div><dt>Type</dt><dd>{val(inspection.inspection_type || inspection.title)}</dd></div>
              <div><dt>Inspector</dt><dd>{val(inspection.inspector)}</dd></div>
              <div><dt>Status</dt><dd>{inspection.status ? <span className="cc-pill info">{inspection.status}</span> : NA}</dd></div>
              <div><dt>Severity</dt><dd>{val(inspection.severity)}</dd></div>
              <div><dt>Findings</dt><dd className="v360-wrap">{val(inspection.findings)}</dd></div>
            </dl>
          )}
      </CardState>
    </Card>
  )
}

const ACT_ICON = { work_order: Wrench, tyre: CircleDot, accident: AlertTriangle, inspection: ClipboardCheck, expense: DollarSign }
const ACT_TONE = { work_order: 't-blue', tyre: 't-green', accident: 't-red', inspection: 't-purple', expense: 't-amber' }

export function ActivityCard({ loading, rows, onViewAll, now, typeLabel }) {
  return (
    <Card title="Recent Activities" action={<ViewAll onClick={onViewAll} />}>
      <CardState state={{ loading, data: loading ? null : rows, error: null }} empty={!rows.length ? 'No activity is recorded for this vehicle.' : null}>
        <div className="cc-list">
          {rows.map((r) => {
            const Icon = ACT_ICON[r.type] || Activity
            return (
              <div className="cc-row" key={r.key}>
                <span className={`cc-row-icon ${ACT_TONE[r.type] || ''}`}><Icon size={15} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{typeLabel(r.type)}{r.ref ? `: ${r.ref}` : ''}</div>
                  <div className="cc-row-meta">{r.detail || r.status || 'No detail recorded'}</div>
                </div>
                <span className="cc-row-time">{relativeDay(r.date, now)}</span>
              </div>
            )
          })}
        </div>
      </CardState>
    </Card>
  )
}

export function OpenWorkOrdersCard({ loading, rows, newTo, allTo }) {
  return (
    <Card title="Open Work Orders" action={<ViewAll to={allTo} />}>
      <CardState state={{ loading, data: loading ? null : rows, error: null }} empty={null}>
        {!rows.length ? (
          <div className="cc-empty">
            <div>No open work orders for this vehicle.<br />
              <Link className="cc-btn v360-btn-inline" to={newTo}><Plus size={13} aria-hidden="true" /> New Work Order</Link>
            </div>
          </div>
        ) : (
          <div className="cc-list">
            {rows.slice(0, 5).map((w) => (
              <div className="cc-row" key={w.id}>
                <span className="cc-row-icon t-blue"><Wrench size={15} aria-hidden="true" /></span>
                <div className="cc-row-main">
                  <div className="cc-row-title">{w.work_order_no || 'Work order'}</div>
                  <div className="cc-row-meta">{w.description || w.work_type || 'No description'}</div>
                </div>
                <div className="cc-row-side">
                  <span className="cc-pill info">{w.status || 'Open'}</span>
                  {w.priority && <span className="cc-row-time">{w.priority}</span>}
                </div>
              </div>
            ))}
            {rows.length > 5 && <p className="v360-note">{rows.length - 5} more open work order{rows.length - 5 === 1 ? '' : 's'}.</p>}
          </div>
        )}
      </CardState>
    </Card>
  )
}

const SEG_COLORS = ['var(--cc-green)', 'var(--cc-blue)', 'var(--cc-amber)', 'var(--cc-purple)']

/** Cost summary: per-currency donut + the four secondary tiles. Never blends currencies. */
export function CostSummaryCard({ loading, split, currency, onCurrency, period, onPeriod, tiles }) {
  const cur = split.find((s) => s.currency === currency) || split[0] || null
  const segments = cur ? [
    { label: 'Tyres', count: cur.tyre, color: SEG_COLORS[0] },
    { label: 'Spare parts', count: cur.spare, color: SEG_COLORS[1] },
    { label: 'Oil & lubricants', count: cur.oil, color: SEG_COLORS[2] },
    { label: 'Other', count: cur.other, color: SEG_COLORS[3] },
  ] : []
  return (
    <Card
      title="Cost Summary"
      sub="Expense grid, per currency. Currencies are never added together."
      action={(
        <select className="cc-select v360-period" aria-label="Cost period" value={period} onChange={(e) => onPeriod(e.target.value)}>
          {COST_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      )}
    >
      <CardState state={{ loading, data: loading ? null : split, error: null }} empty={!cur ? 'No expense lines are recorded for this vehicle in this period.' : null}>
        {split.length > 1 && (
          <div className="v360-cur" role="group" aria-label="Currency">
            {split.map((s) => (
              <button key={s.currency} type="button" className="cc-count" aria-pressed={cur?.currency === s.currency} onClick={() => onCurrency(s.currency)}>{s.currency}</button>
            ))}
          </div>
        )}
        {cur && <Donut segments={segments} total={cur.total} centerLabel={cur.currency} />}
      </CardState>
      <div className="v360-mini">
        {tiles.map((t) => (
          <div key={t.label}><b>{t.value}</b><span>{t.label}</span></div>
        ))}
      </div>
    </Card>
  )
}
