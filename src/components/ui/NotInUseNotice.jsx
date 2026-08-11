import { Info } from 'lucide-react'

/**
 * "This module has no data yet."
 *
 * An enterprise-buyer review found fourteen modules that are complete,
 * polished interfaces over tables holding zero rows - suppliers, purchase
 * orders, goods receipts, warranty, retread, disposals, the tyre pool,
 * preventive maintenance, alerting. Each renders KPI tiles reading 0, a chart
 * with no bars and an empty table, which a reader interprets as a measurement
 * ("we have no failures") rather than an absence ("nothing has been entered").
 * That is the same class of dishonesty as a fabricated number, one step
 * removed - and it costs more trust than the blank screen it was hiding.
 *
 * This states the situation in one line, above the zeros, so nobody mistakes an
 * empty module for a healthy one. It renders NOTHING once a single row exists,
 * so it disappears the moment the module is genuinely in use and can never
 * become stale copy.
 *
 * It is deliberately NOT a gate: the page still works, so an operator can enter
 * the first record. Hiding a module entirely is a separate, existing decision
 * that belongs to Module Control (/console/module-control) - do not build a
 * second mechanism for it here.
 *
 * @param {number|null} count   rows the page loaded; null/undefined = unknown, render nothing
 * @param {string} label        what the module holds, e.g. "purchase orders"
 * @param {string} [hint]       how data gets here, e.g. "Records appear once a PO is raised."
 */
export default function NotInUseNotice({ count, label, hint }) {
  // Unknown (still loading, or the read failed) must NOT claim emptiness -
  // "we could not look" and "there is nothing" are opposite statements.
  if (count == null || !Number.isFinite(Number(count))) return null
  if (Number(count) > 0) return null

  return (
    <div
      className="rounded-xl border px-4 py-3 mb-4 flex items-start gap-2.5"
      style={{ borderColor: 'var(--border-subtle, rgba(148,163,184,0.3))', background: 'rgba(148,163,184,0.07)' }}
      role="status"
    >
      <Info size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 2 }} />
      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          No {label} have been recorded yet.
        </span>{' '}
        Every figure on this page is therefore zero because nothing has been entered, not because
        there is nothing to report.
        {hint ? ` ${hint}` : ''}
      </div>
    </div>
  )
}
