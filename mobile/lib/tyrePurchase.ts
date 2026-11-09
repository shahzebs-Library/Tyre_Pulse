/**
 * tyrePurchase - tyre purchase value on the phone, by the same rules as the web
 * (src/lib/tyreLifetime.js) and the database (tyre_serial_is_strong, v_tyre_lifetime).
 *
 * MIRROR: isStrongSerial() mirrors src/lib/tyreLifetime.js isStrongSerial() and SQL
 * public.tyre_serial_is_strong() - change all three together. The web test
 * src/test/mobileTyrePurchaseMirror.test.js and mobile/__tests__/tyrePurchase.test.ts pin
 * the same serial vectors on both sides.
 *
 * Rule T1: a physical tyre is bought ONCE. A refit row of the same real serial
 * carries no new purchase, so its price is not added again. Rule T9: this is the
 * purchase value recorded on tyre records, NOT the ERP tyre expense (that comes
 * from the expense lines). Rule T10: money is never added across countries.
 */
// Kept dependency-free (no supabase import) so it runs in the plain Node test suite.
// Same mapping as currencyFor() in ./mobileAnalytics.
function currencyFor(country: string): string | null {
  switch (country.trim().toUpperCase()) {
    case 'KSA': case 'SAUDI ARABIA': return 'SAR'
    case 'UAE': return 'AED'
    case 'EGYPT': return 'EGP'
    default: return null
  }
}

const SEQUENCES = new Set(['123456', '1234567', '12345678', '123456789', '1234567890'])

export function isStrongSerial(serial: unknown): boolean {
  const s = String(serial ?? '').trim().toUpperCase()
  if (s.length < 6) return false
  if (!/[0-9]/.test(s)) return false
  if (/^(DOT|NULL|N\/?A|-)/.test(s)) return false
  if (/^[0-9]{3}\//.test(s)) return false
  if (/[0-9]{2,3}\/[0-9]{2}\s*R/.test(s)) return false
  if (/E\+[0-9]+$/.test(s)) return false
  if (/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /]?[0-9]{2,4}$/.test(s)) return false
  if (/^[0-9]{2,3}(\.[0-9]+)?\s*R\s*[0-9]{2}(\.[0-9])?($|[^0-9])/.test(s)) return false
  if (/[,;&]/.test(s)) return false
  if (/^([0-9])\1+$/.test(s)) return false
  if (SEQUENCES.has(s)) return false
  return true
}

export interface PricedRow {
  serial_no?: string | null
  country?: string | null
  cost_per_tyre?: number | string | null
  issue_date?: string | null
}

/**
 * The purchase price each row contributes: the first priced row of a real serial
 * keeps its price, a later row of the same tyre contributes 0 (a refit). Rows with
 * a weak serial keep their own price. Returns a parallel array of numbers.
 */
export function onePricePerTyre<T extends PricedRow>(rows: T[]): number[] {
  const first = new Map<string, number>()
  rows.forEach((r, i) => {
    const cost = Number(r.cost_per_tyre)
    if (!isStrongSerial(r.serial_no) || !(cost > 0)) return
    const key = `${String(r.country ?? '').trim().toUpperCase()}|${String(r.serial_no).trim().toUpperCase()}`
    const cur = first.get(key)
    const d = String(r.issue_date ?? '')
    if (cur == null || d < String(rows[cur].issue_date ?? '')) first.set(key, i)
  })
  const keep = new Set(first.values())
  return rows.map((r, i) => {
    const cost = Number(r.cost_per_tyre)
    if (!(cost > 0)) return 0
    if (!isStrongSerial(r.serial_no)) return cost
    return keep.has(i) ? cost : 0
  })
}

/**
 * One money figure for a set of rows: the currency when every row is from one
 * country, otherwise null (several currencies cannot be added - say "N/A").
 */
export function singleCurrency(rows: PricedRow[]): string | null {
  const countries = new Set(rows.map((r) => String(r.country ?? '').trim().toUpperCase()).filter(Boolean))
  if (countries.size !== 1) return null
  return currencyFor([...countries][0])
}

/** "SAR 12,345" for one currency, or "N/A (several currencies)". */
export function moneyText(value: number, currency: string | null): string {
  if (currency == null) return 'N/A (several currencies)'
  return `${currency} ${Math.round(value).toLocaleString()}`
}
