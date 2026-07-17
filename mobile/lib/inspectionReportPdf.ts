/**
 * Inspection report PDF - builds a single-inspection PDF and shares it via the
 * device share sheet. Mirrors the HTML->PDF pattern used by app/(app)/reports.
 *
 * This is a REAL field report, not a data dump: a branded header with the
 * approval status, a condition-summary KPI strip, a colour-coded tyre layout,
 * a per-position table, observations, and the captured inspector + supervisor
 * signatures. Every section degrades honestly when its data is absent.
 *
 * Condition colours are semantic + fixed (Good=green, Worn=amber,
 * Damaged/Puncture/Flat=red, Missing/none=grey) so the shared report matches the
 * in-app detail view and the tyre diagram exactly.
 */

import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { supabase } from './supabase'
import { diagramPositions } from './tyreDiagramLayouts'

// ── Condition colour system (semantic, fixed hex - shared with the detail view) ──
const COND_GREEN = '#16a34a'
const COND_AMBER = '#ca8a04'
const COND_RED = '#dc2626'
const COND_GREY = '#94a3b8'
const BRAND = '#16a34a'
const INK = '#0f172a'

type Bucket = 'good' | 'worn' | 'critical' | 'missing'

/** Classify a raw condition/risk value into one of four report buckets. */
function conditionBucket(raw: any): Bucket {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s || s === 'none' || s.includes('miss')) return 'missing'
  if (s.includes('good') || s === 'low') return 'good'
  if (s.includes('worn') || s === 'medium') return 'worn'
  if (
    s.includes('damag') || s.includes('punct') || s.includes('flat') ||
    s === 'high' || s === 'critical'
  ) return 'critical'
  return 'missing'
}

/**
 * Resolve a display colour from a raw tyre condition (or legacy risk) value.
 * Accepts condition names (Good/Worn/Damaged/Puncture/Flat/Missing) and the
 * older risk vocabulary (none/low/medium/high/critical).
 */
export function conditionColor(raw: any): string {
  switch (conditionBucket(raw)) {
    case 'good': return COND_GREEN
    case 'worn': return COND_AMBER
    case 'critical': return COND_RED
    default: return COND_GREY
  }
}

/** Best-effort human label for a recorded condition cell. */
export function conditionLabel(c: any): string {
  if (!c) return 'Not recorded'
  return String(c.condition ?? c.risk ?? 'Recorded')
}

export interface InspectionForReport {
  id?: string | null
  title?: string | null
  site?: string | null
  asset_no?: string | null
  vehicle_type?: string | null
  inspector?: string | null
  inspection_date?: string | null
  created_at?: string | null
  status?: string | null
  notes?: string | null
  findings?: string | null
  odometer_km?: number | null
  hour_meter?: number | null
  approval_status?: string | null
  approver_email?: string | null
  approved_at?: string | null
  inspector_signature?: string | null
  approver_signature?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  tyre_conditions?: Record<string, any> | null
}

function esc(v: any): string {
  return v == null || v === ''
    ? '-'
    : String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function orderedPositions(insp: InspectionForReport): string[] {
  const conditions = insp.tyre_conditions ?? {}
  const layout = diagramPositions(insp.vehicle_type ?? '') ?? []
  const keys = Object.keys(conditions)
  // Preferred vehicle layout first, then any extra recorded positions not in it.
  const extra = keys.filter(k => !layout.includes(k))
  const ordered = [...layout, ...extra]
  return ordered.length ? ordered : keys
}

/** Render a stored SVG signature inline, or an honest placeholder. */
function signatureBlock(svg: any, name: string): string {
  const isSvg = typeof svg === 'string' && svg.trim().startsWith('<svg')
  const inner = isSvg
    ? `<div class="sigInk">${svg}</div>`
    : `<div class="sigEmpty">Not signed</div>`
  return `<div class="sigBox">
    ${inner}
    <div class="sigLine"></div>
    <div class="sigName">${esc(name)}</div>
  </div>`
}

const css = `
  * { font-family: -apple-system, Helvetica, Arial, sans-serif; box-sizing: border-box; }
  body { color: ${INK}; padding: 0; font-size: 12px; margin: 0; }
  .wrap { padding: 26px 24px 40px; }
  .top { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid ${BRAND}; padding-bottom: 12px; margin-bottom: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 34px; height: 34px; border-radius: 9px; background: ${BRAND}; color: #fff; font-weight: 800; font-size: 17px; display: flex; align-items: center; justify-content: center; }
  .brandName { font-size: 17px; font-weight: 800; color: ${INK}; }
  .brandTag { font-size: 10px; color: #64748b; margin-top: 1px; }
  .rtitle { text-align: right; }
  .rtitle h1 { font-size: 17px; margin: 0; color: ${INK}; }
  .rtitle .rid { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .statusPill { display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; color: #fff; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .mcard { border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 11px; min-width: 120px; }
  .ml { font-size: 9.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .mv { font-size: 13.5px; font-weight: 700; color: ${INK}; margin-top: 2px; }
  h2 { font-size: 13px; color: ${BRAND}; border-bottom: 2px solid #dcfce7; padding-bottom: 4px; margin: 20px 0 10px; }
  .kpis { display: flex; gap: 8px; margin-bottom: 6px; }
  .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; text-align: center; }
  .kpi .n { font-size: 22px; font-weight: 800; }
  .kpi .l { font-size: 9.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 2px; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 4px 0 12px; font-size: 11px; color: #64748b; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .cell { border-radius: 8px; padding: 8px 10px; min-width: 88px; color: #fff; }
  .cell-pos { font-size: 13px; font-weight: 800; }
  .cell-cond { font-size: 11px; font-weight: 700; opacity: 0.95; margin-top: 2px; }
  .cell-sub { font-size: 10px; opacity: 0.92; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { background: #f8fafc; padding: 6px 8px; text-align: left; font-size: 11px; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
  .pos { font-weight: 800; }
  .cbadge { display: inline-block; padding: 2px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; color: #fff; }
  .notes { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #334155; line-height: 18px; white-space: pre-wrap; }
  .sigs { display: flex; gap: 14px; }
  .sigWrap { flex: 1; }
  .sigCap { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .sigBox { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
  .sigInk { height: 74px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .sigInk svg { max-height: 74px; max-width: 100%; }
  .sigEmpty { height: 74px; display: flex; align-items: center; justify-content: center; color: #cbd5e1; font-style: italic; font-size: 12px; }
  .sigLine { border-top: 1px solid #cbd5e1; margin: 6px 0 4px; }
  .sigName { font-size: 12px; font-weight: 700; color: ${INK}; }
  footer { margin-top: 22px; font-size: 10px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; display: flex; justify-content: space-between; }
`

function statusColor(insp: InspectionForReport): string {
  const a = String(insp.approval_status ?? '').toLowerCase()
  if (a === 'approved') return COND_GREEN
  if (a === 'returned' || a === 'rejected') return COND_RED
  if (a === 'pending') return COND_AMBER
  return '#64748b'
}

function statusText(insp: InspectionForReport): string {
  const a = String(insp.approval_status ?? '').toLowerCase()
  if (a === 'approved') return 'Approved'
  if (a === 'returned') return 'Returned'
  if (a === 'pending') return 'Pending approval'
  return insp.status || 'Recorded'
}

export function buildInspectionHtml(insp: InspectionForReport): string {
  const conditions = insp.tyre_conditions ?? {}
  const positions = orderedPositions(insp)
  const recorded = positions.filter(p => conditions[p])

  const counts = { good: 0, worn: 0, critical: 0, missing: 0 }
  recorded.forEach(p => { counts[conditionBucket(conditions[p]?.condition ?? conditions[p]?.risk)]++ })

  const dateLabel = insp.inspection_date || (insp.created_at ? String(insp.created_at).slice(0, 10) : '-')
  const observations = insp.findings || insp.notes || ''

  const legend = `
    <div class="legend">
      <span><span class="dot" style="background:${COND_GREEN}"></span>Good</span>
      <span><span class="dot" style="background:${COND_AMBER}"></span>Worn</span>
      <span><span class="dot" style="background:${COND_RED}"></span>Damaged / Puncture / Flat</span>
      <span><span class="dot" style="background:${COND_GREY}"></span>Missing / Not recorded</span>
    </div>`

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="n" style="color:${INK}">${positions.length}</div><div class="l">Positions</div></div>
      <div class="kpi"><div class="n" style="color:${COND_GREEN}">${counts.good}</div><div class="l">Good</div></div>
      <div class="kpi"><div class="n" style="color:${COND_AMBER}">${counts.worn}</div><div class="l">Worn</div></div>
      <div class="kpi"><div class="n" style="color:${COND_RED}">${counts.critical}</div><div class="l">Critical</div></div>
      <div class="kpi"><div class="n" style="color:${INK}">${recorded.length}</div><div class="l">Recorded</div></div>
    </div>`

  const grid = positions.length
    ? `<div class="grid">
        ${positions.map(pos => {
          const c = conditions[pos]
          const color = conditionColor(c?.condition ?? c?.risk)
          const sub = [
            c?.tread_depth_mm ? `${c.tread_depth_mm}mm` : (c?.tread_depth != null ? `${c.tread_depth}mm` : null),
            c?.pressure_psi ? `${c.pressure_psi} psi` : (c?.pressure != null ? `${c.pressure} psi` : null),
          ].filter(Boolean).join(' | ')
          return `<div class="cell" style="background:${color}">
            <div class="cell-pos">${esc(pos)}</div>
            <div class="cell-cond">${c ? esc(conditionLabel(c)) : 'Not recorded'}</div>
            ${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ''}
          </div>`
        }).join('')}
      </div>`
    : `<p class="notes">No tyre positions recorded.</p>`

  const rows = recorded.length
    ? `<table>
        <tr><th>Position</th><th>Condition</th><th>Tread</th><th>Pressure</th><th>Serial</th><th>Notes</th></tr>
        ${recorded.map(pos => {
          const c = conditions[pos]
          const color = conditionColor(c?.condition ?? c?.risk)
          const tread = c?.tread_depth_mm ? `${c.tread_depth_mm} mm` : (c?.tread_depth != null ? `${c.tread_depth} mm` : '-')
          const pressure = c?.pressure_psi ? `${c.pressure_psi} psi` : (c?.pressure != null ? `${c.pressure} psi` : '-')
          const serial = c?.serial_number ?? c?.serial ?? '-'
          return `<tr>
            <td class="pos">${esc(pos)}</td>
            <td><span class="cbadge" style="background:${color}">${esc(conditionLabel(c))}</span></td>
            <td>${esc(tread)}</td>
            <td>${esc(pressure)}</td>
            <td>${esc(serial)}</td>
            <td>${esc(c?.notes)}</td>
          </tr>`
        }).join('')}
      </table>`
    : `<p class="notes">No tyre conditions were recorded for this inspection.</p>`

  const approvedLine = insp.approved_at
    ? `<div class="mcard"><div class="ml">Approved</div><div class="mv">${esc(String(insp.approved_at).slice(0, 10))}${insp.approver_email ? ` · ${esc(insp.approver_email)}` : ''}</div></div>`
    : ''
  const gpsLine = (insp.gps_lat != null && insp.gps_lng != null)
    ? `<div class="mcard"><div class="ml">GPS</div><div class="mv">${insp.gps_lat.toFixed(4)}, ${insp.gps_lng.toFixed(4)}</div></div>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>
    <div class="wrap">
      <div class="top">
        <div class="brand">
          <div class="logo">TP</div>
          <div>
            <div class="brandName">Tyre Pulse</div>
            <div class="brandTag">Fleet Tyre Intelligence</div>
          </div>
        </div>
        <div class="rtitle">
          <h1>Tyre Inspection Report</h1>
          <div class="rid">${esc(insp.id ? String(insp.id).slice(0, 8).toUpperCase() : dateLabel)}</div>
          <div class="statusPill" style="background:${statusColor(insp)}">${esc(statusText(insp))}</div>
        </div>
      </div>

      <div class="meta">
        <div class="mcard"><div class="ml">Asset</div><div class="mv">${esc(insp.asset_no)}</div></div>
        <div class="mcard"><div class="ml">Vehicle Type</div><div class="mv">${esc(insp.vehicle_type)}</div></div>
        <div class="mcard"><div class="ml">Site</div><div class="mv">${esc(insp.site)}</div></div>
        <div class="mcard"><div class="ml">Date</div><div class="mv">${esc(dateLabel)}</div></div>
        <div class="mcard"><div class="ml">Inspector</div><div class="mv">${esc(insp.inspector)}</div></div>
        ${insp.odometer_km != null ? `<div class="mcard"><div class="ml">Odometer</div><div class="mv">${esc(insp.odometer_km)} km</div></div>` : ''}
        ${insp.hour_meter != null ? `<div class="mcard"><div class="ml">Hour Meter</div><div class="mv">${esc(insp.hour_meter)} h</div></div>` : ''}
        ${approvedLine}
        ${gpsLine}
      </div>

      <h2>Condition Summary</h2>
      ${kpis}
      ${legend}

      <h2>Tyre Layout (${positions.length})</h2>
      ${grid}

      <h2>Recorded Conditions (${recorded.length})</h2>
      ${rows}

      ${observations ? `<h2>Observations</h2><div class="notes">${esc(observations)}</div>` : ''}

      <h2>Sign-off</h2>
      <div class="sigs">
        <div class="sigWrap">
          <div class="sigCap">Inspector</div>
          ${signatureBlock(insp.inspector_signature, insp.inspector || '')}
        </div>
        <div class="sigWrap">
          <div class="sigCap">Supervisor approval</div>
          ${signatureBlock(insp.approver_signature, insp.approver_email || (insp.approval_status === 'pending' ? 'Awaiting approval' : ''))}
        </div>
      </div>

      <footer>
        <span>Generated ${new Date().toLocaleString()}</span>
        <span>Tyre Pulse Inspector</span>
      </footer>
    </div>
  </body></html>`
}

function safeFileName(insp: InspectionForReport): string {
  const raw = `Inspection ${insp.asset_no ?? ''} ${insp.inspection_date ?? ''}`.trim()
  return raw.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Inspection'
}

/** Build the PDF for an already-loaded inspection and open the share sheet. Throws on failure. */
export async function shareInspectionPdf(insp: InspectionForReport): Promise<void> {
  const html = buildInspectionHtml(insp)
  const { uri } = await Print.printToFileAsync({ html })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: safeFileName(insp),
      UTI: 'com.adobe.pdf',
    })
  }
}

/** Fetch a synced inspection by id, then build + share its PDF. Throws on failure. */
export async function shareInspectionById(id: string): Promise<void> {
  const { data, error } = await supabase.from('inspections')
    .select('id,title,site,asset_no,vehicle_type,inspector,inspection_date,created_at,status,notes,findings,odometer_km,hour_meter,approval_status,approver_email,approved_at,inspector_signature,approver_signature,gps_lat,gps_lng,tyre_conditions')
    .eq('id', id).single()
  if (error) throw error
  if (!data) throw new Error('Inspection not found.')
  await shareInspectionPdf(data as InspectionForReport)
}
