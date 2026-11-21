// Scheduled inventory digest (send-scheduled-reports, report_type 'inventory').
// Deno is not available in this environment, so the edge function's pure modules
// (inventory.ts, delivery.ts) are imported directly and exercised with a fake
// service-role client and a fake e-mail provider. The wiring in index.ts is pinned
// by a source check.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildInventoryDigest, loadInventoryDigest, renderInventoryHtml, inventoryCsv, inventoryAttachment, requireInventoryOrg,
} from '../../supabase/functions/send-scheduled-reports/inventory.ts'
import { deliverSchedule, RETRY_BACKOFF_MS } from '../../supabase/functions/send-scheduled-reports/delivery.ts'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const snap = (o) => ({
  organisation_id: ORG_A, country: 'KSA', site: 'S1', currency: 'SAR', balances: 2, qty_on_hand: 10, qty_reserved: 1,
  owned_valued_qty: 6, owned_unvalued_qty: 3, owned_pending_allocation_qty: 1, valuation_complete: false,
  critical_lines: 1, low_lines: 0, open_exceptions: 0, open_discrepancies: 2, open_cost_reconciliations: 3, pending_approvals: 1, ...o,
})

// Fake supabase-js service client: records every query and applies eq / range filters.
function fakeSvc (tables, log = []) {
  return {
    log,
    from (table) {
      const q = { table, filters: [], range: null, single: false, op: 'select', payload: null }
      log.push(q)
      const rows = () => (tables[table] ?? []).filter(r => q.filters.every(([c, v]) => r[c] === v))
      const b = {
        select () { return b },
        eq (c, v) { q.filters.push([c, v]); return b },
        order () { return b },
        range (a, z) { q.range = [a, z]; return b },
        maybeSingle () { q.single = true; return b },
        update (p) { q.op = 'update'; q.payload = p; return b },
        insert (p) { q.op = 'insert'; q.payload = p; (tables[table] ??= []).push(p); return Promise.resolve({ data: null, error: null }) },
        then (res, rej) {
          let data = rows()
          if (q.range) data = data.slice(q.range[0], q.range[1] + 1)
          if (q.single) data = data[0] ?? null
          return Promise.resolve({ data, error: null }).then(res, rej)
        },
      }
      return b
    },
  }
}

describe('inventory digest (pure)', () => {
  it('never blends currencies, keeps valued / unvalued / pending separate', () => {
    const d = buildInventoryDigest(ORG_A, [snap({}), snap({ country: 'UAE', site: 'D1', currency: 'AED', owned_valued_qty: 4, owned_unvalued_qty: 0, owned_pending_allocation_qty: 0, valuation_complete: true })],
      { showMoney: true, amounts: new Map([['KSA|S1|SAR', 60], ['UAE|D1|AED', 40]]) })
    expect(d.byCurrency.map(c => [c.currency, c.valuedQty, c.valuedAmount, c.unvaluedQty, c.pendingQty, c.valuationComplete]))
      .toEqual([['AED', 4, 40, 0, 0, true], ['SAR', 6, 60, 3, 1, false]])
    const html = renderInventoryHtml({ name: 'Weekly' }, d, 'https://tyrepulse.app/stock')
    expect(html).toContain('SAR 60'); expect(html).toContain('AED 40')
    expect(html).not.toMatch(/>\s*(SAR|AED)?\s*100\b/) // no 60 + 40 total anywhere
    expect(html).toContain('never valued at zero')
  })

  it('honest empty state: no table of zeros, no attachment', () => {
    const d = buildInventoryDigest(ORG_A, [], { showMoney: true })
    expect(d.empty).toBe(true)
    const html = renderInventoryHtml({ name: 'W' }, d, 'x')
    expect(html).toContain('No inventory balances are recorded')
    expect(html).not.toContain('<table')
  })

  it('money withheld unless the creator is an administrator; quantities still sent', () => {
    const d = buildInventoryDigest(ORG_A, [snap({})], { showMoney: false })
    expect(d.byCurrency[0].valuedAmount).toBeNull()
    expect(renderInventoryHtml({ name: 'W' }, d, 'x')).toContain('Values are withheld')
    expect(inventoryCsv(d)).toContain('Withheld')
  })

  it('attachment: Resend shape, base64 CSV, formula injection neutralised', () => {
    const d = buildInventoryDigest(ORG_A, [snap({ site: '=HYPERLINK("x")' })], { showMoney: true, amounts: new Map() })
    const a = inventoryAttachment(d, '2026-11-20')
    expect(a.filename).toBe('TyrePulse Inventory 2026-11-20.csv')
    const csv = atob(a.content)
    expect(csv.split('\r\n')[0]).toMatch(/^Country,Site,Currency/)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('inventory digest (loader): org isolation', () => {
  it('every read is filtered by the schedule org; another company never appears', async () => {
    const svc = fakeSvc({
      v_inv_report_snapshot: [snap({}), snap({ organisation_id: ORG_B, site: 'B-SITE' })],
      profiles: [{ id: 'u-admin', role: 'Admin', org_id: ORG_A, approved: true, locked: false }],
      stock_records: [{ organisation_id: ORG_A, ownership: 'owned', country: 'KSA', site: 'S1', currency: 'SAR', valued_value: 12.5 },
        { organisation_id: ORG_B, ownership: 'owned', country: 'KSA', site: 'S1', currency: 'SAR', valued_value: 999 }],
    })
    const d = await loadInventoryDigest(svc, { org_id: ORG_A, created_by: 'u-admin' })
    expect(d.lines.map(l => l.site)).toEqual(['S1'])
    expect(d.byCurrency[0].valuedAmount).toBe(12.5)
    for (const q of svc.log.filter(x => x.table !== 'profiles')) expect(q.filters).toContainEqual(['organisation_id', ORG_A])
  })

  it('a schedule without an org is refused before any read', async () => {
    const svc = fakeSvc({})
    await expect(loadInventoryDigest(svc, { org_id: null })).rejects.toThrow(/organisation-scoped/)
    expect(svc.log).toHaveLength(0)
    expect(() => requireInventoryOrg('  ')).toThrow()
  })

  it('an admin of ANOTHER company gets no money in this company digest', async () => {
    const svc = fakeSvc({
      v_inv_report_snapshot: [snap({})],
      profiles: [{ id: 'u-adminB', role: 'Admin', org_id: ORG_B, approved: true, locked: false }],
    })
    const d = await loadInventoryDigest(svc, { org_id: ORG_A, created_by: 'u-adminB' })
    expect(d.showMoney).toBe(false)
  })
})

describe('delivery: same path and retry behaviour as every other report type', () => {
  const base = (svc, fetchFn, render) => ({
    svc, s: { id: 's1', name: 'Inv', report_type: 'inventory', org_id: ORG_A, recipients: ['a@example.com'] },
    now: new Date('2026-11-20T10:00:00Z'), render, fetchFn, resendKey: 'k', fromEmail: 'r@x',
    computeNextRun: () => '2026-11-27T10:00:00.000Z',
    requireOrg: (o) => { if (!o) throw new Error('no org'); return o },
  })

  it('successful build: attachment in the payload, sent logged, next run advanced', async () => {
    const svc = fakeSvc({})
    const sent = []
    const fetchFn = async (_u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => '' } }
    const d = buildInventoryDigest(ORG_A, [snap({})], { showMoney: false })
    const r = await deliverSchedule(base(svc, fetchFn, async () => ({ subject: 'S', html: 'H', attachments: [inventoryAttachment(d, '2026-11-20')] })))
    expect(r).toBe('sent')
    expect(sent[0].attachments[0].filename).toMatch(/\.csv$/)
    const upd = svc.log.find(q => q.table === 'report_schedules')
    expect(upd.payload).toMatchObject({ last_status: 'sent', next_run_at: '2026-11-27T10:00:00.000Z' })
    expect(svc.log.find(q => q.table === 'report_send_log').payload).toMatchObject({ status: 'sent', report_type: 'inventory' })
  })

  it('send failure: logged failed with the reason, backed off one hour, then retried on the next run', async () => {
    const tables = {}
    const svc = fakeSvc(tables)
    const failing = async () => ({ ok: false, status: 503, text: async () => 'provider down' })
    const render = async () => ({ subject: 'S', html: 'H' })
    expect(await deliverSchedule(base(svc, failing, render))).toBe('failed')
    const upd = svc.log.find(q => q.table === 'report_schedules')
    expect(upd.payload.last_status).toBe('failed')
    expect(new Date(upd.payload.next_run_at).getTime() - new Date('2026-11-20T10:00:00Z').getTime()).toBe(RETRY_BACKOFF_MS)
    expect(tables.report_send_log[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('Resend 503') })
    const ok = async () => ({ ok: true, text: async () => '' })
    expect(await deliverSchedule({ ...base(svc, ok, render), now: new Date('2026-11-20T11:00:00Z') })).toBe('sent')
    expect(tables.report_send_log.map(r => r.status)).toEqual(['failed', 'sent'])
  })

  it('a render error (for example a refused read) is a logged failure, not a crash', async () => {
    const tables = {}
    const r = await deliverSchedule(base(fakeSvc(tables), async () => { throw new Error('never called') }, async () => { throw new Error('inventory snapshot query failed: denied') }))
    expect(r).toBe('failed')
    expect(tables.report_send_log[0].error).toContain('inventory snapshot query failed')
  })
})

describe('edge function wiring', () => {
  const src = readFileSync(path.resolve(__dirname, '../../supabase/functions/send-scheduled-reports/index.ts'), 'utf8')
  it('inventory branch, created_by read, every type through deliverSchedule', () => {
    expect(src).toMatch(/type === 'inventory'/)
    expect(src).toMatch(/loadInventoryDigest\(svc, s\)/)
    expect(src).toMatch(/SCHEDULE_COLS = '[^']*created_by'/)
    expect(src).toMatch(/await deliverSchedule\(/)
    expect(src).not.toMatch(/\\u[0-9a-fA-F]{4}/)
  })
})
