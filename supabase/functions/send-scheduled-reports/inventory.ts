// inventory.ts - the scheduled inventory digest (report_type 'inventory').
//
// Pure module (no Deno, no network): the edge function passes its service-role
// client, so the web test suite can import and test it directly, the same way it
// tests money.ts.
//
// RULES (owner, 2026-11-20)
//   1. Organisation-scoped. The service role bypasses RLS, so EVERY read here is
//      filtered by the schedule's org explicitly, and a schedule without an org is
//      refused before anything is read.
//   2. Currency is never blended. Money is grouped per currency; there is no
//      cross-currency total anywhere in the e-mail or the attachment.
//   3. Valued, unvalued and pending-allocation quantities are shown separately.
//      An unvalued unit has no value; nothing is ever valued at zero.
//   4. Money is shown only when the schedule's creator is an Admin or a super
//      admin (roles that always hold stock:view_value). Otherwise the amounts are
//      withheld and the e-mail says so; quantities still go out.
//   5. Honest empty state: no balances = an e-mail that says there is nothing to
//      report, never a table of zeros.
// No backslash-u escapes and no dash punctuation in output strings.

// deno-lint-ignore no-explicit-any
type Svc = any

export type InvSnapshotRow = {
  organisation_id: string
  country: string | null
  site: string | null
  currency: string | null
  balances: number | null
  qty_on_hand: number | null
  qty_reserved: number | null
  owned_valued_qty: number | null
  owned_unvalued_qty: number | null
  owned_pending_allocation_qty: number | null
  valuation_complete: boolean | null
  critical_lines: number | null
  low_lines: number | null
  open_exceptions: number | null
  open_discrepancies: number | null
  open_cost_reconciliations: number | null
  pending_approvals: number | null
}

export type InvLine = {
  country: string
  site: string
  currency: string
  balances: number
  qtyOnHand: number
  qtyReserved: number
  valuedQty: number
  unvaluedQty: number
  pendingQty: number
  valuedAmount: number | null
  valuationComplete: boolean
  critical: number
  low: number
  exceptions: number
  discrepancies: number
  costReconciliations: number
  approvals: number
}

export type InvCurrencyTotal = {
  currency: string
  valuedQty: number
  unvaluedQty: number
  pendingQty: number
  valuedAmount: number | null
  valuationComplete: boolean
}

export type InventoryDigest = {
  orgId: string
  empty: boolean
  showMoney: boolean
  lines: InvLine[]
  byCurrency: InvCurrencyTotal[]
  attention: { critical: number; low: number; exceptions: number; discrepancies: number; costReconciliations: number; approvals: number }
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function requireInventoryOrg (orgId: string | null | undefined): string {
  const id = typeof orgId === 'string' ? orgId.trim() : ''
  if (!id) throw new Error('An inventory digest needs an organisation-scoped schedule.')
  return id
}

/** Pure: snapshot rows (+ optional valued amounts keyed country|site|currency) to the digest. */
export function buildInventoryDigest (
  orgId: string,
  rows: InvSnapshotRow[],
  opts: { showMoney: boolean; amounts?: Map<string, number> },
): InventoryDigest {
  const own = rows.filter((r) => r.organisation_id === orgId)
  const lines: InvLine[] = own.map((r) => {
    const currency = String(r.currency ?? '').toUpperCase()
    const key = `${r.country ?? ''}|${r.site ?? ''}|${currency}`
    return {
      country: String(r.country ?? 'N/A'),
      site: String(r.site ?? 'Unassigned'),
      currency,
      balances: n(r.balances),
      qtyOnHand: n(r.qty_on_hand),
      qtyReserved: n(r.qty_reserved),
      valuedQty: n(r.owned_valued_qty),
      unvaluedQty: n(r.owned_unvalued_qty),
      pendingQty: n(r.owned_pending_allocation_qty),
      valuedAmount: opts.showMoney ? (opts.amounts?.get(key) ?? 0) : null,
      valuationComplete: r.valuation_complete === true,
      critical: n(r.critical_lines),
      low: n(r.low_lines),
      exceptions: n(r.open_exceptions),
      discrepancies: n(r.open_discrepancies),
      costReconciliations: n(r.open_cost_reconciliations),
      approvals: n(r.pending_approvals),
    }
  }).sort((a, b) => a.currency.localeCompare(b.currency) || a.country.localeCompare(b.country) || a.site.localeCompare(b.site))

  const cur = new Map<string, InvCurrencyTotal>()
  for (const l of lines) {
    const t = cur.get(l.currency) ?? { currency: l.currency, valuedQty: 0, unvaluedQty: 0, pendingQty: 0, valuedAmount: opts.showMoney ? 0 : null, valuationComplete: true }
    t.valuedQty += l.valuedQty
    t.unvaluedQty += l.unvaluedQty
    t.pendingQty += l.pendingQty
    if (t.valuedAmount !== null && l.valuedAmount !== null) t.valuedAmount += l.valuedAmount
    t.valuationComplete = t.valuationComplete && l.valuationComplete
    cur.set(l.currency, t)
  }
  const sum = (k: keyof InvLine) => lines.reduce((s, l) => s + n(l[k]), 0)
  return {
    orgId,
    empty: lines.every((l) => l.balances === 0 && l.qtyOnHand === 0),
    showMoney: opts.showMoney,
    lines,
    byCurrency: [...cur.values()].map((t) => ({ ...t, valuedAmount: t.valuedAmount === null ? null : Math.round(t.valuedAmount * 100) / 100 })),
    attention: {
      critical: sum('critical'), low: sum('low'), exceptions: sum('exceptions'), discrepancies: sum('discrepancies'),
      costReconciliations: sum('costReconciliations'), approvals: sum('approvals'),
    },
  }
}

/** Reads the snapshot and (when allowed) the valued amounts, strictly for one org. */
export async function loadInventoryDigest (svc: Svc, schedule: { org_id: string | null; created_by?: string | null }): Promise<InventoryDigest> {
  const orgId = requireInventoryOrg(schedule.org_id)
  const { data: rows, error } = await svc.from('v_inv_report_snapshot').select('*').eq('organisation_id', orgId)
  if (error) throw new Error(`inventory snapshot query failed: ${error.message}`)

  // Money only for a schedule created by an Admin or a super admin of the same company.
  let showMoney = false
  if (schedule.created_by) {
    const { data: p } = await svc.from('profiles').select('role,is_super_admin,org_id,organisation_id,approved,locked')
      .eq('id', schedule.created_by).maybeSingle()
    showMoney = !!p && p.approved === true && p.locked !== true
      && (p.is_super_admin === true || (p.role === 'Admin' && (p.org_id === orgId || p.organisation_id === orgId)))
  }
  let amounts: Map<string, number> | undefined
  if (showMoney) {
    amounts = new Map()
    const pageSize = 1000
    for (let from = 0; from < 50_000; from += pageSize) {
      const { data, error: e } = await svc.from('stock_records')
        .select('id,country,site,currency,valued_value,ownership')
        .eq('organisation_id', orgId).eq('ownership', 'owned').order('id').range(from, from + pageSize - 1)
      if (e) throw new Error(`inventory value query failed: ${e.message}`)
      const page = (data ?? []) as Array<Record<string, unknown>>
      for (const r of page) {
        const key = `${r.country ?? ''}|${r.site ?? ''}|${String(r.currency ?? '').toUpperCase()}`
        amounts.set(key, (amounts.get(key) ?? 0) + n(r.valued_value))
      }
      if (page.length < pageSize) break
      if (from + pageSize >= 50_000) throw new Error('More than 50,000 stock lines; the inventory digest was stopped to avoid an incomplete value.')
    }
  }
  return buildInventoryDigest(orgId, (rows ?? []) as InvSnapshotRow[], { showMoney, amounts })
}

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c)
const num = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const amt = (v: number | null, currency: string): string => v === null ? 'Withheld' : `${currency || 'No currency'} ${num(v)}`

export function renderInventoryHtml (s: { name: string }, d: InventoryDigest, appUrl: string): string {
  const head = `<div style="background:#111827;border-radius:12px 12px 0 0;padding:22px 26px;color:#fff"><div style="font-size:19px;font-weight:800">TyrePulse Inventory Digest</div><div style="font-size:12px;color:#d1d5db;margin-top:4px">Schedule: ${esc(s.name)}</div></div>`
  if (d.empty) {
    return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#0f172a">${head}<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px;font-size:14px">No inventory balances are recorded for this organisation yet, so there is nothing to value or reconcile. This is a statement of no data, not a zero stock value.</div></div>`
  }
  const cur = d.byCurrency.map((c) => `<tr><td style="padding:7px">${esc(c.currency || 'No currency')}</td><td style="padding:7px;text-align:right">${num(c.valuedQty)}</td><td style="padding:7px;text-align:right">${esc(amt(c.valuedAmount, c.currency))}</td><td style="padding:7px;text-align:right">${num(c.unvaluedQty)}</td><td style="padding:7px;text-align:right">${num(c.pendingQty)}</td><td style="padding:7px">${c.valuationComplete ? 'Complete' : 'Incomplete'}</td></tr>`).join('')
  const rows = d.lines.map((l) => `<tr><td style="padding:6px">${esc(l.country)}</td><td style="padding:6px">${esc(l.site)}</td><td style="padding:6px">${esc(l.currency)}</td><td style="padding:6px;text-align:right">${num(l.qtyOnHand)}</td><td style="padding:6px;text-align:right">${num(l.valuedQty)}</td><td style="padding:6px;text-align:right">${esc(amt(l.valuedAmount, l.currency))}</td><td style="padding:6px;text-align:right">${num(l.unvaluedQty)}</td><td style="padding:6px;text-align:right">${num(l.pendingQty)}</td><td style="padding:6px;text-align:right">${num(l.critical + l.low)}</td></tr>`).join('')
  const a = d.attention
  const moneyNote = d.showMoney
    ? 'Values are per currency. Currencies are never added together.'
    : 'Values are withheld: this schedule was not created by an administrator. Quantities are shown in full.'
  return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#0f172a">${head}<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px">`
    + `<p style="font-size:13px">${esc(moneyNote)} Unvalued units have no recorded cost and are never valued at zero; pending allocation units wait for a person to decide which receipt they came from.</p>`
    + `<h2 style="font-size:13px;text-transform:uppercase">By currency</h2><table role="presentation" width="100%" cellspacing="0" style="font-size:12px;border-collapse:collapse"><tr style="background:#f8fafc;font-weight:700"><td style="padding:7px">Currency</td><td style="padding:7px;text-align:right">Valued qty</td><td style="padding:7px;text-align:right">Valued amount</td><td style="padding:7px;text-align:right">Unvalued qty</td><td style="padding:7px;text-align:right">Pending allocation qty</td><td style="padding:7px">Valuation</td></tr>${cur}</table>`
    + `<h2 style="font-size:13px;text-transform:uppercase">Needs attention</h2><p style="font-size:13px">Critical or low lines: ${num(a.critical + a.low)} | open shortages: ${num(a.exceptions)} | open discrepancies: ${num(a.discrepancies)} | open cost reconciliations: ${num(a.costReconciliations)} | pending approvals: ${num(a.approvals)}</p>`
    + `<h2 style="font-size:13px;text-transform:uppercase">By country and site</h2><table role="presentation" width="100%" cellspacing="0" style="font-size:11px;border-collapse:collapse"><tr style="background:#f8fafc;font-weight:700"><td style="padding:6px">Country</td><td style="padding:6px">Site</td><td style="padding:6px">Currency</td><td style="padding:6px;text-align:right">On hand</td><td style="padding:6px;text-align:right">Valued qty</td><td style="padding:6px;text-align:right">Valued amount</td><td style="padding:6px;text-align:right">Unvalued qty</td><td style="padding:6px;text-align:right">Pending qty</td><td style="padding:6px;text-align:right">Low lines</td></tr>${rows}</table>`
    + `<p style="font-size:11px;color:#64748b">The full table is attached as a CSV file.</p><a href="${esc(appUrl)}" style="display:inline-block;background:#facc15;color:#111827;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;text-decoration:none">Open Inventory</a></div></div>`
}

const csvCell = (v: unknown): string => {
  let s = String(v ?? '').replace(/[^\x20-\x7e]/g, ' ')
  if (/^[=+\-@]/.test(s)) s = `'${s}` // spreadsheet formula injection
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function inventoryCsv (d: InventoryDigest): string {
  const head = ['Country', 'Site', 'Currency', 'Balances', 'On hand', 'Reserved', 'Valued qty', 'Valued amount', 'Unvalued qty',
    'Pending allocation qty', 'Valuation complete', 'Critical lines', 'Low lines', 'Open shortages', 'Open discrepancies',
    'Open cost reconciliations', 'Pending approvals']
  const body = d.lines.map((l) => [l.country, l.site, l.currency, l.balances, l.qtyOnHand, l.qtyReserved, l.valuedQty,
    l.valuedAmount === null ? 'Withheld' : l.valuedAmount, l.unvaluedQty, l.pendingQty, l.valuationComplete ? 'yes' : 'no',
    l.critical, l.low, l.exceptions, l.discrepancies, l.costReconciliations, l.approvals].map(csvCell).join(','))
  return [head.join(','), ...body].join('\r\n') + '\r\n'
}

/** Resend attachment shape ({ filename, content: base64 }), as send-email uses. */
export function inventoryAttachment (d: InventoryDigest, day: string): { filename: string; content: string } {
  return { filename: `TyrePulse Inventory ${day}.csv`, content: btoa(inventoryCsv(d)) }
}
