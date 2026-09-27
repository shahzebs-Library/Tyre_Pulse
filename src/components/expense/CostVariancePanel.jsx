/**
 * CostVariancePanel - the "why did this cost change" answer, on screen.
 *
 * Presentation only. Every figure comes from src/lib/costVariance.js, which is
 * where the rules live: the parts must sum to the whole, a currency is never
 * blended, and nothing is claimed that the data does not carry.
 *
 * READING ORDER IS THE POINT. The narrative comes FIRST, because a manager who
 * reads one thing should read the answer, not a chart they have to interpret.
 * Then the waterfall, which is the same answer as arithmetic. Then price
 * against volume. Then the drill lists, for whoever has to act on it.
 *
 * The residual is never hidden. A dimension list that has been truncated shows
 * its "everything else" row in the same column as the named rows, and the
 * footer restates the total so a reader can add the column up and check.
 */
import { useMemo, useState } from 'react'
import {
  TrendingUp, TrendingDown, Sparkles, AlertTriangle, Info,
  ArrowRightLeft, PackagePlus, PackageMinus, Tag, Boxes,
} from 'lucide-react'
import {
  decomposeVariance, narrate, fmtMoney, fmtPct, fmtQty,
} from '../../lib/costVariance'
import { compareValues, isBlank } from '../../lib/consoleTable'
import EnterpriseTable from '../ui/EnterpriseTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const moneyExport = (v) => (v == null ? 'N/A' : v)

/* Cost page convention, same as CostCpkPanels: falling cost is the good
   direction, so down is green and up is red. */
const toneFor = (v) => (v === 0
  ? 'text-[var(--text-dim)]'
  : (v > 0 ? 'text-red-400' : 'text-emerald-400'))

const barFor = (v) => (v > 0 ? 'bg-red-500/70' : 'bg-emerald-500/70')

const EFFECT_ICON = {
  volume: Boxes,
  price: Tag,
  newItems: PackagePlus,
  stoppedItems: PackageMinus,
  notDecomposable: Info,
  rounding: Info,
  unexplained: AlertTriangle,
}

const DRIVER_LABEL = {
  price: 'Price',
  volume: 'Quantity',
  new: 'New line',
  stopped: 'Stopped',
  mixed: 'Price and quantity',
  flat: 'No change',
  unpriced: 'No quantity',
}

const DRIVER_TONE = {
  price: 'bg-amber-500/15 text-amber-400',
  volume: 'bg-sky-500/15 text-sky-400',
  new: 'bg-violet-500/15 text-violet-400',
  stopped: 'bg-slate-500/20 text-[var(--text-secondary)]',
  mixed: 'bg-teal-500/15 text-teal-400',
  flat: 'bg-slate-500/20 text-[var(--text-dim)]',
  unpriced: 'bg-slate-500/20 text-[var(--text-dim)]',
}

const DIM_TABS = [
  { key: 'by_site', label: 'Site' },
  { key: 'by_asset', label: 'Asset' },
  { key: 'by_item', label: 'Item' },
  { key: 'by_cost_center', label: 'Cost centre' },
  { key: 'by_asset_type', label: 'Asset type' },
]

function Money({ value, currency, signed = false }) {
  if (value == null) return <span className="text-[var(--text-dim)]">N/A</span>
  const sign = signed && value > 0 ? '+' : ''
  return <span>{sign}{fmtMoney(value, currency)}</span>
}

/* ---------------------------------------------------------------- states */

function Shell({ children, title = 'Why the cost changed' }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} className="text-[var(--accent)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Unavailable({ reason, blended }) {
  return (
    <Shell>
      <div className="flex items-start gap-3 rounded-lg bg-[var(--surface-raised)] p-4">
        {blended
          ? <ArrowRightLeft size={16} className="text-amber-400 mt-0.5 shrink-0" />
          : <Info size={16} className="text-[var(--text-dim)] mt-0.5 shrink-0" />}
        <div>
          <p className="text-sm text-[var(--text-primary)]">
            {blended
              ? 'A change cannot be taken apart across more than one currency.'
              : 'No breakdown to show yet.'}
          </p>
          {reason ? (
            <p className="text-xs text-[var(--text-secondary)] mt-1">{reason}</p>
          ) : null}
        </div>
      </div>
    </Shell>
  )
}

/* ------------------------------------------------------------- waterfall */

/**
 * The five effects as a bar per term, scaled against the largest single term.
 * A footer restates the total so the column can be added up by eye; that check
 * is the reason to trust the rest of the panel.
 */
function Waterfall({ dec }) {
  const { terms, total, closes } = dec.effects
  const cur = dec.currency
  const max = Math.max(...terms.map((t) => Math.abs(t.amount)), 1)

  return (
    <div>
      <div className="space-y-1.5">
        {terms.map((t) => {
          const Icon = EFFECT_ICON[t.key] || Info
          const w = (Math.abs(t.amount) / max) * 100
          return (
            <div key={t.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={12} className="text-[var(--text-dim)] shrink-0" />
                  <span className="text-xs text-[var(--text-primary)]">{t.label}</span>
                  {t.key === 'unexplained' ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                      Gap
                    </span>
                  ) : null}
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface-raised)] overflow-hidden">
                  <div className={`h-full rounded-full ${barFor(t.amount)}`}
                    style={{ width: `${w}%` }} />
                </div>
                {t.meaning ? (
                  <p className="text-[10px] text-[var(--text-dim)] mt-1">{t.meaning}</p>
                ) : null}
              </div>
              <div className={`text-sm font-mono tabular-nums ${toneFor(t.amount)}`}>
                <Money value={t.amount} currency={cur} signed />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-subtle)]">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          Total change
        </span>
        <span className={`text-sm font-mono font-semibold tabular-nums ${toneFor(total)}`}>
          <Money value={total} currency={cur} signed />
        </span>
      </div>
      {!closes ? (
        <p className="text-[11px] text-amber-400 mt-2 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          The parts do not fully meet the total. The gap above is the amount the
          item level detail does not account for.
        </p>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------- price against volume */

function PriceVolume({ dec }) {
  const cur = dec.currency
  const { groups, itemsBoth, itemsNew, itemsStopped } = dec.effects
  const gross = groups.reduce((s, g) => s + Math.abs(g.amount), 0)

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {groups.filter((g) => g.key !== 'notDecomposable').map((g) => (
          <div key={g.key} className="rounded-lg bg-[var(--surface-raised)] p-3">
            <p className="text-[11px] text-[var(--text-dim)] mb-1">{g.label}</p>
            <p className={`text-base font-mono font-semibold tabular-nums ${toneFor(g.amount)}`}>
              <Money value={g.amount} currency={cur} signed />
            </p>
            <p className="text-[10px] text-[var(--text-dim)] mt-0.5">
              {gross > 0 ? `${fmtPct(Math.abs(g.amount) / gross)} of movement` : 'N/A'}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[var(--text-dim)] mt-2">
        Price and volume are measured on the {fmtQty(itemsBoth)} item codes bought in
        both periods. {fmtQty(itemsNew)} started and {fmtQty(itemsStopped)} stopped;
        those have no pair of prices to compare, so they are counted as mix rather
        than being given a price change that never happened.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------ drill lists */

function ContributionTable({ dim, currency }) {
  const all = useMemo(() => [
    ...dim.rows,
    ...(dim.tail ? [{ ...dim.tail, isRemainder: true }] : []),
    ...(dim.remainder ? [dim.remainder] : []),
  ], [dim])
  const max = Math.max(...all.map((r) => Math.abs(r.delta)), 1)
  const columns = useMemo(() => [
    {
      id: 'label', header: 'Name', accessorFn: (r) => blank(r.label), ...sortable,
      cell: ({ row: { original: r } }) => (
        <span className={r.isRemainder ? 'text-[var(--text-dim)] italic' : 'text-[var(--text-primary)]'}>{r.label}</span>
      ),
    },
    ...[['previous', 'Previous', false], ['current', 'This period', false], ['delta', 'Change', true]].map(([key, header, signed]) => ({
      id: key, header, accessorFn: (r) => (r[key] == null ? undefined : r[key]), ...sortable,
      meta: { align: 'right', exportValue: (r) => moneyExport(r[key]) },
      cell: ({ row: { original: r } }) => (
        <span className={`font-mono tabular-nums ${signed ? toneFor(r.delta) : ''}`}>
          <Money value={r[key]} currency={currency} signed={signed} />
        </span>
      ),
    })),
    {
      id: 'share', header: 'Share', enableSorting: false, meta: { export: false },
      cell: ({ row: { original: r } }) => (
        <div className="h-1.5 w-24 rounded-full bg-[var(--surface-raised)] overflow-hidden" aria-hidden="true">
          <div className={`h-full rounded-full ${barFor(r.delta)}`} style={{ width: `${(Math.abs(r.delta) / max) * 100}%` }} />
        </div>
      ),
    },
  ], [currency, max])

  return (
    <div>
      <EnterpriseTable columns={columns} data={all} getRowId={(r, i) => `${r.label}-${i}`}
        searchPlaceholder="Search name..." enableColumnFilters={false}
        exportFileName="Cost change contributions" emptyMessage="Nothing moved on this view." />
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-subtle)] text-xs">
        <span className="font-medium text-[var(--text-secondary)]">Total change</span>
        <span className={`font-mono font-semibold tabular-nums ${toneFor(dim.total)}`}>
          <Money value={dim.total} currency={currency} signed />
        </span>
      </div>
      {dim.grossIsLowerBound ? (
        <p className="text-[10px] text-[var(--text-dim)] mt-2">
          The final row nets many members into one figure, so movement within it
          can cancel out and the real total movement may be larger.
        </p>
      ) : null}
    </div>
  )
}

function ItemTable({ items, currency }) {
  const columns = useMemo(() => [
    {
      id: 'label', header: 'Item', accessorFn: (i) => blank(i.label), ...sortable,
      meta: { exportValue: (i) => `${i.label || 'N/A'} (${i.code || 'N/A'})` },
      cell: ({ row: { original: i } }) => (
        <div className="max-w-[16rem]">
          <div className="text-[var(--text-primary)] truncate" title={i.label}>{i.label}</div>
          <div className="text-[10px] text-[var(--text-dim)]">{i.code}</div>
        </div>
      ),
    },
    {
      id: 'driver', header: 'Driver', accessorFn: (i) => DRIVER_LABEL[i.driver] || i.driver, ...sortable,
      meta: { filterVariant: 'select' },
      cell: ({ row: { original: i } }) => (
        <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${DRIVER_TONE[i.driver] || DRIVER_TONE.flat}`}>
          {DRIVER_LABEL[i.driver] || i.driver}
        </span>
      ),
    },
    {
      id: 'qty', header: 'Quantity', accessorFn: (i) => (i.qtyCurrent == null ? undefined : i.qtyCurrent), ...sortable,
      meta: { align: 'right', exportValue: (i) => `${fmtQty(i.qtyPrevious)} to ${fmtQty(i.qtyCurrent)}` },
      cell: ({ row: { original: i } }) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{fmtQty(i.qtyPrevious)} to {fmtQty(i.qtyCurrent)}</span>
      ),
    },
    {
      id: 'price', header: 'Unit price', accessorFn: (i) => (i.priceCurrent == null ? undefined : i.priceCurrent), ...sortable,
      meta: {
        align: 'right',
        exportValue: (i) => (i.pricePrevious == null || i.priceCurrent == null ? 'N/A' : `${fmtMoney(i.pricePrevious)} to ${fmtMoney(i.priceCurrent)}`),
      },
      cell: ({ row: { original: i } }) => (
        <span className="font-mono tabular-nums text-[var(--text-secondary)] whitespace-nowrap">
          {i.pricePrevious == null || i.priceCurrent == null
            // one side is missing, so there is no price change to show
            ? <span className="text-[var(--text-dim)]">N/A</span>
            : <>{fmtMoney(i.pricePrevious)} to {fmtMoney(i.priceCurrent)}</>}
        </span>
      ),
    },
    ...[['priceEffect', 'Price effect', null], ['volumeEffect', 'Volume effect', null], ['delta', 'Change', currency]].map(([key, header, cur]) => ({
      id: key, header, accessorFn: (i) => (i[key] == null ? undefined : i[key]), ...sortable,
      meta: { align: 'right', exportValue: (i) => moneyExport(i[key]) },
      cell: ({ row: { original: i } }) => (
        <span className={`font-mono tabular-nums ${key === 'delta' ? 'font-medium' : ''} ${toneFor(i[key])}`}>
          <Money value={i[key]} currency={cur} signed />
        </span>
      ),
    })),
  ], [currency])

  return (
    <EnterpriseTable columns={columns} data={items} getRowId={(i) => String(i.code)}
      searchPlaceholder="Search item or code..." exportFileName="Cost change by item"
      emptyMessage="No item moved in this window." />
  )
}

/* ------------------------------------------------------------------ main */

/**
 * @param {object} props
 * @param {object} props.variance   get_cost_variance payload (V378)
 * @param {object} [props.snapshot] get_cost_cpk_overview payload, used only to
 *   fill a dimension V378 did not return, so the panel degrades rather than
 *   blanking if the migration is not applied
 * @param {boolean} [props.loading]
 * @param {string} [props.error]
 */
export default function CostVariancePanel({ variance, snapshot, loading, error }) {
  const [tab, setTab] = useState('by_site')

  const dec = useMemo(
    () => decomposeVariance(variance, { fallbackDims: snapshot || null, limit: 12 }),
    [variance, snapshot],
  )
  const story = useMemo(() => narrate(dec), [dec])

  if (loading) {
    return (
      <Shell>
        <div className="space-y-2 animate-pulse">
          <div className="h-4 w-3/4 rounded bg-[var(--surface-raised)]" />
          <div className="h-3 w-full rounded bg-[var(--surface-raised)]" />
          <div className="h-3 w-5/6 rounded bg-[var(--surface-raised)]" />
          <div className="h-24 w-full rounded bg-[var(--surface-raised)] mt-4" />
        </div>
      </Shell>
    )
  }
  if (error) {
    return <Unavailable reason={error} blended={false} />
  }
  if (!dec.ok) {
    return <Unavailable reason={dec.reason} blended={dec.blended} />
  }

  const cur = dec.currency
  const rising = dec.totals.delta > 0
  const HeadIcon = dec.totals.delta === 0 ? Info : (rising ? TrendingUp : TrendingDown)
  const tabs = DIM_TABS.filter((t) => dec.byDim[t.key])
  const activeTab = dec.byDim[tab] ? tab : (tabs[0]?.key || null)

  return (
    <Shell>
      {/* 1. the answer, in words, before any chart */}
      <div className="rounded-lg bg-[var(--surface-raised)] p-4 mb-5">
        <div className="flex items-start gap-3">
          <HeadIcon size={18} className={`mt-0.5 shrink-0 ${toneFor(dec.totals.delta)}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {story.headline}
            </p>
            <ul className="mt-2 space-y-1.5">
              {story.lines.map((l, i) => (
                <li key={i} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-3">
            What the change is made of
          </h4>
          <Waterfall dec={dec} />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-3">
            Price, volume or mix
          </h4>
          <PriceVolume dec={dec} />
        </div>
      </div>

      {/* 3. the drill, for whoever has to act on it */}
      {activeTab ? (
        <div className="mt-6">
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                type="button"
                aria-pressed={activeTab === t.key}
                className={`min-h-[44px] sm:min-h-[32px] px-3 rounded-lg text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                  activeTab === t.key
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.label}
              </button>
            ))}
            {dec.byDim[activeTab]?.fromFallback ? (
              <span className="text-[10px] text-[var(--text-dim)] ml-1">
                ranked from the overview data
              </span>
            ) : null}
          </div>
          <ContributionTable dim={dec.byDim[activeTab]} currency={cur} />
        </div>
      ) : null}

      {dec.items.length ? (
        <div className="mt-6">
          <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-3">
            The items behind it
          </h4>
          <ItemTable items={dec.items} currency={cur} />
          {dec.itemsTail ? (
            <p className="text-[10px] text-[var(--text-dim)] mt-2">
              A further {fmtQty(dec.itemsTail.count)} item codes moved, together
              {' '}{fmtMoney(dec.itemsTail.delta, cur)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </Shell>
  )
}
