/**
 * accidentPdf - generate and share a full accident/claim PDF on device.
 * Pulls the latest parts + case log, renders an HTML report, prints to PDF
 * (expo-print) and opens the share sheet (expo-sharing).
 */

import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { supabase } from './supabase'
import { resolveStorageUrls } from './storageRefs'
import {
  AccidentRecord, AccidentPart, AccidentRemark,
  CLAIM_STATUS_LABELS, PART_STATUS_LABELS,
  RECOVERY_SOURCE_LABELS, RECOVERY_STATUS_LABELS,
} from './types'

const esc = (v: any): string =>
  v == null ? '-' : String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const money = (n: any): string =>
  n == null || isNaN(Number(n)) ? '-' : 'SAR ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })

function row(label: string, value: any): string {
  return `<tr><td class="l">${esc(label)}</td><td class="v">${esc(value)}</td></tr>`
}

export async function exportAccidentPdf(accident: AccidentRecord): Promise<void> {
  const [partsRes, remarksRes] = await Promise.all([
    supabase.from('accident_parts').select('*').eq('accident_id', accident.id).order('created_at'),
    supabase.from('accident_remarks').select('*').eq('accident_id', accident.id).order('created_at', { ascending: false }),
  ])
  const parts: AccidentPart[] = partsRes.data ?? []
  const remarks: AccidentRemark[] = remarksRes.data ?? []

  const partsTotal = parts.reduce((s, p) => s + (Number(p.total_cost) || 0), 0)
  const grossCost = (Number(accident.estimated_damage_cost) || 0) + partsTotal
  const netCost = Math.max(0, grossCost - (Number(accident.recovered_amount) || 0))
  const photos = await resolveStorageUrls(Array.isArray(accident.photos) ? accident.photos.filter(Boolean) : [])

  const partsRows = parts.length
    ? parts.map(p => `<tr>
        <td>${esc(p.part_name)}${p.part_number ? ` <span class="muted">#${esc(p.part_number)}</span>` : ''}</td>
        <td>${Number(p.quantity)}</td>
        <td>${money(p.unit_cost)}</td>
        <td>${money(p.total_cost)}</td>
        <td>${esc(PART_STATUS_LABELS[p.status] ?? p.status)}</td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="muted">No parts recorded</td></tr>`

  const logRows = remarks.length
    ? remarks.map(r => `<li><b>${esc(r.author_name ?? 'User')}</b> · ${esc(new Date(r.created_at).toLocaleString())}<br/>${esc(r.remark)}</li>`).join('')
    : '<li class="muted">No log entries</li>'

  const photoTags = photos.length
    ? `<div class="photos">${photos.map(u => `<img src="${esc(u)}"/>`).join('')}</div>`
    : '<p class="muted">No photos</p>'

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    * { font-family: -apple-system, Helvetica, Arial, sans-serif; }
    body { color: #0f172a; padding: 22px; font-size: 12px; }
    h1 { font-size: 19px; margin: 0; }
    h2 { font-size: 13px; margin: 18px 0 6px; color: #dc2626; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    .sub { color: #64748b; font-size: 11px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 4px 6px; text-align: left; vertical-align: top; }
    td.l { color: #64748b; width: 42%; }
    td.v { font-weight: 600; }
    .kv td { border-bottom: 1px solid #f1f5f9; }
    .parts th { background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
    .parts td { border-bottom: 1px solid #f8fafc; }
    .total { font-weight: 800; }
    .muted { color: #94a3b8; }
    ul { padding-left: 16px; } li { margin-bottom: 6px; }
    .photos { display: flex; flex-wrap: wrap; gap: 6px; }
    .photos img { width: 150px; height: 110px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; }
    .net { background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px; margin-top: 6px; }
  </style></head><body>
    <h1>Accident & Claim Report</h1>
    <div class="sub">${esc(accident.asset_no)} · ${esc(accident.site)} · ${esc(accident.incident_date)} · #${esc(String(accident.id).slice(0, 8).toUpperCase())}</div>

    <h2>Incident</h2>
    <table class="kv">
      ${row('Type', accident.accident_type)}
      ${row('Severity', accident.severity)}
      ${row('Status', accident.status)}
      ${row('Location', accident.location)}
      ${row('Reported by', accident.reporter_name)}
      ${row('Description', accident.description)}
      ${row('Injuries', accident.injuries ? `Yes (${accident.injury_count})` : 'No')}
      ${row('Third party', accident.third_party_involved ? 'Yes' : 'No')}
      ${row('Police report', accident.police_report_no)}
      ${row('Damage', accident.damage_description)}
      ${row('Estimated damage', money(accident.estimated_damage_cost))}
    </table>

    <h2>Claim & Responsibility</h2>
    <table class="kv">
      ${row('Claim status', CLAIM_STATUS_LABELS[accident.claim_status ?? 'none'])}
      ${row('Responsible party', accident.responsible_party)}
      ${row('Liable party', accident.liable_party)}
      ${row('Who pays', accident.payer)}
      ${row('Driver', accident.driver_name)}
      ${row('Insurer', accident.insurer)}
      ${row('Policy / Claim no', accident.policy_no)}
      ${row('Claim amount', money(accident.claim_amount))}
      ${row('Approved amount', money(accident.claim_approved_amount))}
      ${row('Deductible', money(accident.deductible))}
    </table>

    <h2>Cost Recovery</h2>
    <table class="kv">
      ${row('Recovery status', RECOVERY_STATUS_LABELS[accident.recovery_status ?? 'pending'])}
      ${row('Recovered amount', money(accident.recovered_amount))}
      ${row('Recovery source', RECOVERY_SOURCE_LABELS[accident.recovery_source ?? 'none'])}
      ${row('Recovery date', accident.recovery_date)}
      ${row('Recovery reference', accident.recovery_reference)}
    </table>
    <div class="net">
      Gross cost ${money(grossCost)} &nbsp;−&nbsp; Recovered ${money(accident.recovered_amount)} &nbsp;=&nbsp;
      <span class="total">Net cost ${money(netCost)}</span>
    </div>

    <h2>Parts & Repairs</h2>
    <table class="parts">
      <tr><th>Part</th><th>Qty</th><th>Unit</th><th>Total</th><th>Status</th></tr>
      ${partsRows}
      <tr><td colspan="3" class="total">Total parts cost</td><td class="total">${money(partsTotal)}</td><td></td></tr>
    </table>

    <h2>Case Log</h2>
    <ul>${logRows}</ul>

    <h2>Photos</h2>
    ${photoTags}

    <p class="sub" style="margin-top:18px">Generated ${esc(new Date().toLocaleString())} · TyrePulse</p>
  </body></html>`

  const { uri } = await Print.printToFileAsync({ html })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Accident Report' })
  }
}
