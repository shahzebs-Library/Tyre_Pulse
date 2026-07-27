/**
 * CostValue - the governed way to put a cost total on screen.
 *
 * Every cost KPI used to render `formatCurrency(number, activeCurrency)`. That
 * is safe for one country and WRONG for the default "All countries" view, where
 * activeCurrency falls back to SAR while the underlying figure is a
 * SAR + AED + EGP blend. On live data that renders "SAR 138,443,319", a number
 * that is not a real amount of any currency.
 *
 * This component takes a governed split (from loadGovernedCostSplit) and:
 *   - single country  -> the same single figure as before, correctly labelled
 *   - mixed scope     -> one line per currency, because that IS the answer
 *
 * It never invents a combined number, and renders "N/A" for a missing value.
 */
import { countryCostSetFrom, formatCountrySet, formatMoney, money } from '../../lib/governedCost'
import { pickCost } from '../../lib/costSources'

/** The mode's amount from a per-country row ({ tyre, maintenance }). */
const amountFor = (mode, row) => pickCost(mode, { tyre: row?.tyre, maintenance: row?.maintenance })

/**
 * @param {object}  props
 * @param {object}  props.split   result of loadGovernedCostSplit
 *   ({ tyre, maintenance, currency, blended, byCountry })
 * @param {string} [props.mode]   'combined' | 'tyres' | 'maintenance'
 * @param {string} [props.className]
 * @param {boolean}[props.compact] one line instead of a stacked list when mixed
 */
export default function CostValue({ split, mode = 'combined', className = '', compact = false }) {
  if (!split) return <span className={className}>N/A</span>

  // Single country: one correctly-labelled figure, arithmetically identical to
  // the pre-migration render.
  if (!split.blended) {
    return (
      <span className={className}>
        {formatMoney(money(amountFor(mode, split), split.currency))}
      </span>
    )
  }

  // Mixed scope: there is no single total. Show one figure per currency.
  const rows = formatCountrySet(
    countryCostSetFrom(split.byCountry || [], (r) => amountFor(mode, r))
  )
  if (!rows.length) return <span className={className}>N/A</span>

  if (compact) {
    return <span className={className}>{rows.map((r) => r.display).join('  |  ')}</span>
  }

  return (
    <span className={className} style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((r) => (
        <span key={r.country} style={{ whiteSpace: 'nowrap' }}>
          <span style={{ opacity: 0.7, fontSize: '0.78em', marginRight: 6 }}>{r.country}</span>
          {r.display}
        </span>
      ))}
    </span>
  )
}

/**
 * Label for the scope, so a screen can say what it is showing:
 * "SAR" for a single country, "3 currencies" for a mixed scope.
 */
export function costScopeLabel(split) {
  if (!split) return 'N/A'
  if (!split.blended) return split.currency
  const n = split.byCountry?.length || 0
  return n ? `${n} currencies` : 'Mixed'
}
