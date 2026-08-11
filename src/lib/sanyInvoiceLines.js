/**
 * sanyInvoiceLines - pure helpers (no I/O) for the SANY per-machine detail.
 *
 * A SANY proforma is a table of machines, not one number. Until the machine
 * lines were loaded the app showed only the document total, so nobody could
 * check what the total was made of. These helpers answer the two questions a
 * reader actually has when they open one:
 *
 *   1. Do the machine lines add up to the gross the document itself states?
 *      A silent mismatch is the failure this whole surface exists to prevent,
 *      so a difference is always named and quantified, never rounded away.
 *   2. How does that gross become the net the fleet is charged? Gross, then
 *      each deduction, then net, in one place.
 *
 * Everything returns null rather than 0 when a figure is genuinely unknown -
 * an invoice whose PDF was never supplied has no lines, which is not the same
 * statement as "this invoice covers no machines".
 */

const num = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Round to the cent so a float sum cannot invent a 0.0000001 discrepancy. */
const cents = (n) => Math.round(n * 100) / 100

/**
 * Deductions are stored as free jsonb and the two loaded documents already
 * disagree about the amount key (`amount_usd` on the SANY Automobile lines,
 * `amount` on the local generator contract). Read both rather than silently
 * dropping one of them, which would understate the deductions and make the
 * gross-to-net walk fail to close.
 *
 * @returns {Array<{label: string, amountUsd: number|null}>}
 */
export function deductionRows(invoice) {
  const raw = invoice?.deductions
  const list = Array.isArray(raw) ? raw : []
  return list.map((d, i) => ({
    label: String(d?.label ?? d?.name ?? `Deduction ${i + 1}`),
    amountUsd: num(d?.amount_usd ?? d?.amount ?? d?.value),
  }))
}

/** Sum of the deductions, or null when none are recorded. */
export function deductionTotal(invoice) {
  const rows = deductionRows(invoice)
  if (!rows.length) return null
  const known = rows.filter((r) => r.amountUsd != null)
  if (!known.length) return null
  return cents(known.reduce((s, r) => s + r.amountUsd, 0))
}

/**
 * Compare the machine lines against the gross the invoice states.
 *
 * `status` is one of:
 *   'no_lines'  - no machine detail has been loaded for this invoice
 *   'no_gross'  - lines exist but the invoice states no gross to check against
 *   'match'     - the lines add up to the stated gross, to the cent
 *   'mismatch'  - they do not, and `difference` is by how much
 */
export function reconcileSanyLines(lines = [], invoice = null) {
  const list = Array.isArray(lines) ? lines : []
  const linesTotal = list.length
    ? cents(list.reduce((s, l) => s + (num(l?.amount_usd) ?? 0), 0))
    : null
  const units = list.length
    ? list.reduce((s, l) => s + (num(l?.units) ?? 0), 0)
    : null
  const gross = num(invoice?.gross_amount)
  const net = num(invoice?.net_amount)
  const deductions = deductionTotal(invoice)

  // Every branch assigns. Do NOT seed this with 'match': a later branch that
  // forgot to set it would then claim the invoice reconciles, which is the one
  // thing this function exists to never say by accident.
  let status
  let difference = null
  if (!list.length) status = 'no_lines'
  else if (gross == null) status = 'no_gross'
  else {
    difference = cents(linesTotal - gross)
    status = difference === 0 ? 'match' : 'mismatch'
  }

  return {
    count: list.length,
    units,
    linesTotal,
    gross,
    deductions,
    net,
    status,
    difference,
  }
}

/**
 * One sentence a non-technical owner can act on. It never says "balanced"
 * unless the arithmetic actually balanced.
 */
export function reconcileMessage(rec, { currency = 'USD' } = {}) {
  if (!rec) return ''
  const money = (v) => `${currency} ${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  switch (rec.status) {
    case 'no_lines':
      return 'No machine detail loaded for this invoice - the PDF has not been supplied.'
    case 'no_gross':
      return `${rec.count} machine lines total ${money(rec.linesTotal)}. The invoice states no gross amount to check this against.`
    case 'match':
      return `The ${rec.count} machine lines add up to ${money(rec.linesTotal)}, which is exactly the gross this invoice states.`
    case 'mismatch': {
      const word = rec.difference > 0 ? 'more than' : 'less than'
      return `The ${rec.count} machine lines add up to ${money(rec.linesTotal)}, which is ${money(rec.difference)} ${word} the ${money(rec.gross)} gross this invoice states. Check the document before using either figure.`
    }
    default:
      return ''
  }
}

/**
 * Gross, each deduction, net - the walk shown under the machine table.
 * `net` is derived only when the invoice does not carry its own net figure,
 * and is flagged `derived` so a computed number is never mistaken for a stated
 * one. VAT is deliberately absent: it is recoverable, so it is not a cost.
 */
export function grossToNetRows(invoice) {
  const gross = num(invoice?.gross_amount)
  const deductions = deductionRows(invoice)
  const statedNet = num(invoice?.net_amount)
  const dedTotal = deductionTotal(invoice)
  const derivedNet = gross != null && dedTotal != null ? cents(gross - dedTotal) : null

  const rows = []
  if (gross != null) rows.push({ key: 'gross', label: 'Gross (as invoiced)', amountUsd: gross, kind: 'gross' })
  deductions.forEach((d, i) => {
    rows.push({ key: `ded-${i}`, label: `Less: ${d.label}`, amountUsd: d.amountUsd == null ? null : -d.amountUsd, kind: 'deduction' })
  })
  const net = statedNet != null ? statedNet : derivedNet
  if (net != null) {
    rows.push({
      key: 'net',
      label: statedNet != null ? 'Net payable' : 'Net payable (derived from the deductions above)',
      amountUsd: net,
      kind: 'net',
      derived: statedNet == null,
    })
  }
  return rows
}

/** Convert a USD figure at the invoice's own rate; null when there is no rate. */
export function toSar(amountUsd, fxRate) {
  const a = num(amountUsd)
  const r = num(fxRate)
  if (a == null || r == null) return null
  return cents(a * r)
}

/** Rows for the machine-lines Excel export, in the order shown on screen. */
export function lineExportRows(lines = [], invoice = null) {
  const rate = num(invoice?.fx_rate)
  return (Array.isArray(lines) ? lines : []).map((l) => ({
    line_no: l?.line_no ?? null,
    machinery: l?.machinery ?? '',
    model: l?.model ?? '',
    charge_standard: l?.charge_standard ?? '',
    contract_year: l?.contract_year ?? '',
    activation_date: l?.activation_date ?? '',
    service_period: l?.service_period ?? '',
    units: num(l?.units),
    usage_detail: l?.usage_detail ?? '',
    amount_usd: num(l?.amount_usd),
    amount_sar: toSar(l?.amount_usd, rate),
  }))
}

export const LINE_EXPORT_COLUMNS = [
  'line_no', 'machinery', 'model', 'charge_standard', 'contract_year',
  'activation_date', 'service_period', 'units', 'usage_detail',
  'amount_usd', 'amount_sar',
]

export const LINE_EXPORT_HEADERS = [
  'Line', 'Machinery', 'Model', 'Charge standard', 'Contract year',
  'Activation date', 'Service period', 'Units', 'Usage', 'Amount USD', 'Amount SAR',
]
