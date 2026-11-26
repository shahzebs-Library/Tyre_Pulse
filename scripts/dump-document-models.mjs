#!/usr/bin/env node
/**
 * Dumps the WEB document models for fixed fixtures into
 * tyre_pulse_flutter/test/fixtures/document_models.json, so the Flutter tests
 * can prove the Dart builders print exactly what the web prints.
 *
 *   TZ=Asia/Riyadh node scripts/dump-document-models.mjs
 *
 * The time zone is pinned (GMT+3) because both builders print local times;
 * the Dart test passes the same fixed offset. Re-run after changing a spec or
 * a web builder, then re-run the Flutter tests.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.env.TZ !== 'Asia/Riyadh') {
  console.error('Run with TZ=Asia/Riyadh so the fixture times are GMT+3.')
  process.exit(1)
}

// The web modules import the Supabase client at load time; these placeholders
// only satisfy that import. Nothing here talks to a server.
process.env.VITE_SUPABASE_URL ||= 'http://127.0.0.1:54321'
process.env.VITE_SUPABASE_ANON_KEY ||= 'placeholder-anon-key-for-model-dump'

const generatedAt = '2026-01-07T10:00:00Z'

const chargeDetail = {
  access: 'driver',
  actions: ['charge_appeal'],
  charge: {
    id: 'c1', charge_no: 'DC-2026-00001', version: 7, category: 'traffic_fine', source_type: 'driver_fine',
    source_id: 'f1', source_summary: { type: 'driver_fine', label: 'RTA-55 · TM101' }, source_link_unverified: true,
    amount: 250.5, currency: 'SAR', status: 'scheduled', basis: 'Speeding fine issued to the vehicle while assigned to this driver.',
    incident_at: '2026-01-02T08:15:00Z', created_at: '2026-01-05T10:00:00Z', notified_at: '2026-01-05T11:30:00Z',
    issued_by_name: 'Supervisor One', notified_by_name: 'Supervisor One', deducted_amount: 0,
    driver_response: 'accepted', response_explanation: null, acknowledged_at: '2026-01-06T09:05:00Z',
    schedule_monthly_wage: 3000, schedule_cap_pct: 16.67, schedule_cap_amount: 500, schedule_rule: 'ksa_labour_law', scheduled_by_name: 'Finance One',
    scheduled_at: '2026-01-06T12:00:00Z', site: 'JEDDAH', country: 'KSA', asset_no: 'TM101',
    supersedes_charge_id: null, superseded_by_charge_id: null, reversal_code: null, close_reason: null,
  },
  driver: { driver_name: 'Driver A', driver_id: 'EMP1' },
  evidence: [
    { kind: 'document', label: 'Fine notice', ref: 'driver_fine/f1', added_by_name: 'Supervisor One', created_at: '2026-01-05T10:00:00Z' },
    { kind: 'photo', label: 'Camera frame', ref: 'tp-storage://tyre-photos/modules/driver-charge/u1/1_0_ab.jpg', added_by_name: 'Supervisor One', created_at: '2026-01-05T10:01:00Z' },
  ],
  settings: { cap_pct: 20, appeal_window_days: 7, country_rule: { rule: 'ksa_labour_law', statutory: true }, objection_last_day: '2026-01-27' },
  signatures: [
    { kind: 'driver_acceptance', signer_name: 'Driver A', statement_text: 'أوافق.', statement_version: 'deduction-consent-v2', statement_language: 'ar', signed_at: '2026-01-06T09:05:00Z', charge_version: 3, signature: 'data:image/png;base64,AAAA', recorded_by_name: 'Driver A' },
    { kind: 'refusal_witness', signer_name: 'Witness', statement_text: '', statement_version: null, signed_at: '2026-09-06T16:45:00Z', charge_version: 2, recorded_by_name: null },
  ],
  decisions: [
    { created_at: '2026-01-06T10:00:00Z', stage: 'supervisor', decision: 'approve', decided_by_name: 'Manager Two', reason: 'Fine confirmed' },
    { created_at: '2026-01-06T11:00:00Z', stage: 'finance', decision: 'approve', decided_by_name: null, reason: '' },
  ],
  appeal: null,
  instalments: [
    { seq: 1, due_month: '2026-02-01', amount: 200, currency: 'SAR', status: 'scheduled', payroll_reference: null, deducted_at: null },
    { seq: 2, due_month: '2026-03-01', amount: 50.5, currency: 'SAR', status: 'deducted', payroll_reference: 'PR-3', deducted_at: '2026-03-28T20:30:00Z' },
  ],
  events: [
    { created_at: '2026-01-05T10:00:00Z', actor_name: 'Supervisor One', action: 'charge_issue', details: { reason: 'Issued' } },
    { created_at: '2026-01-05T11:30:00Z', actor_name: null, action: 'charge_notify', details: {} },
    { created_at: '2026-01-05T11:31:00Z', actor_name: 'System', action: 'some_new_action', details: { reason: 'x' } },
  ],
}

const handoverRow = {
  id: '3f2a9c10-1111-2222-3333-444455556666', document_no: 'HO-TM101-2026-0004', report_no: 'R-7',
  asset_no: 'TM101', handover_type: 'checkout', handover_at: '2026-09-05T13:20:00Z',
  from_driver: 'Yard', to_driver: 'Driver A', from_signed_name: 'Yard Keeper', to_signed_name: '',
  site: 'JEDDAH', country: 'KSA', odometer_km: 123456.7, hour_meter: 4500, fuel_level_pct: 62.5,
  condition_rating: 'good', cleanliness: 'acceptable', approval_status: 'pending_supervisor',
  from_signature: 'data:image/png;base64,AAAA', from_signed_at: '2026-09-05T13:25:00Z',
  to_signature: 'data:image/png;base64,BBBB', to_signed_at: '2026-09-05T13:31:00Z',
  latitude: 21.4858, longitude: 39.1925, location_accuracy_m: 12.6, location_status: 'captured',
  location_captured_at: '2026-09-05T13:31:00Z', frozen_at: '2026-09-05T13:25:00Z', from_on_behalf: true, to_on_behalf: false,
  supervisor_name: null, supervisor_signature: null, supervisor_at: null,
  incharge_name: null, incharge_signature: null, incharge_at: null,
}
const legacyRow = { id: 'abcdef12-0000', asset_no: 'PL9', handover_type: 'checkin', to_driver: 'Old Driver', signature_url: 'data:image/png;base64,CCCC', location_status: 'denied', odometer_km: null }

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
try {
  const charge = await server.ssrLoadModule('/src/lib/driverChargePdf.js')
  const pdf = await server.ssrLoadModule('/src/lib/vehicleHandoverPdf.js')
  const auth = await server.ssrLoadModule('/src/lib/handoverAuthorization.js')
  const SPEC = pdf.HANDOVER_PDF_SPEC

  const handoverModel = (row, ctx) => {
    const fieldValue = (f) => (f.source ? ctx[f.source] : ((row[f.column] == null || String(row[f.column]).trim() === '') && f.fallback_column ? row[f.fallback_column] : row[f.column]))
    const loc = auth.rowLocation(row)
    const locSection = SPEC.sections.find((s) => s.key === 'location')
    return {
      documentNumber: pdf.documentNumber(row),
      headerLines: SPEC.header.right_lines.map((line) => `${line.label}: ${pdf.formatSpecValue(line.format, fieldValue(line))}`),
      statusWord: SPEC.status_words[String(row.approval_status || '').toLowerCase()]?.word || 'No sign-off',
      detailRows: pdf.handoverPdfRows(row),
      tiles: SPEC.sections.find((s) => s.key === 'condition').tiles.map((t) => [t.label, pdf.formatSpecValue(t.format, fieldValue(t))]),
      location: loc
        ? [`${auth.formatCoords(loc)}${loc.accuracy != null ? ` (within ${Math.round(loc.accuracy)} m)` : ''}`,
          `${locSection.status_text.captured}${row.location_captured_at ? ` at ${pdf.formatSpecValue('datetime', row.location_captured_at)}` : ''}`,
          auth.openStreetMapUrl(loc)]
        : [locSection.status_text[row.location_status] || 'No location recorded'],
      locationLink: loc ? auth.openStreetMapUrl(loc) : null,
      driverSignatures: pdf.signatureBlocks(row, SPEC.sections.find((s) => s.key === 'driver_signatures')),
      approval: pdf.signatureBlocks(row, SPEC.sections.find((s) => s.key === 'approval')),
      lockedNote: row.frozen_at ? `Signed record. Content locked at ${pdf.formatSpecValue('datetime', row.frozen_at)}.` : null,
      sectionKeys: SPEC.sections.map((s) => s.key),
    }
  }

  const ctxFor = (row, marks, photos) => ({ document_no: pdf.documentNumber(row), generated_at: generatedAt, damage_mark_count: String(marks), photo_count: String(photos) })
  const out = {
    note: 'Generated by scripts/dump-document-models.mjs (TZ=Asia/Riyadh). Do not edit by hand.',
    utcOffsetMinutes: 180,
    generatedAt,
    charge: { input: chargeDetail, language: 'en', model: charge.buildChargeDocument(chargeDetail, { generatedAt, language: 'en' }) },
    handover: [
      { input: handoverRow, damageMarkCount: 3, photoCount: 2, model: handoverModel(handoverRow, ctxFor(handoverRow, 3, 2)) },
      { input: legacyRow, damageMarkCount: 0, photoCount: 0, model: handoverModel(legacyRow, ctxFor(legacyRow, 0, 0)) },
    ],
  }
  const target = resolve(root, 'tyre_pulse_flutter/test/fixtures/document_models.json')
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`Wrote ${target}`)
} finally {
  await server.close()
}
