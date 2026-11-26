import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import Card from '../ui/Card'
import DateField from '../ui/DateField'
import EnterpriseTable from '../ui/EnterpriseTable'
import { listMovementsInRange, listTyreIssuesInRange } from '../../lib/api/stock'
import { summarizeLedger, dailyLedger, tyresFitted, utilisationGap } from '../../lib/stockLedger'
import { localDay } from '../../lib/stockManagementAnalytics'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage } from '../../contexts/LanguageContext'

const signed = (n) => (n > 0 ? '+' : '') + n
const tone = (n) => (n > 0 ? 'text-green-500' : n < 0 ? 'text-red-500' : 'text-[var(--text-muted)]')
const PRESETS = [['today', 0], ['last7', 6], ['last30', 29], ['last90', 89]]

function Tile({ label, value, hint, valueClass = '' }) {
  return <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--panel-2)] p-3">
    <div className="text-xs text-[var(--text-muted)]">{label}</div>
    <div className={'text-2xl font-bold mt-1 tabular-nums ' + valueClass}>{value}</div>
    {hint && <div className="text-xs text-[var(--text-muted)] mt-1">{hint}</div>}
  </div>
}

/** Stock movement ledger for a date window: received, utilised, count corrections and balances. */
export default function StockMovementsPanel({ records, country, site }) {
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const today = new Date()
  const [from, setFrom] = useState(localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)))
  const [to, setTo] = useState(localDay(today))
  const [movements, setMovements] = useState([])
  const [issues, setIssues] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!from || !to || from > to) { setError(t('wmsissue.movements.badRange')); return }
    setLoading(true); setError('')
    try {
      // End is exclusive: the whole of the chosen last day is included.
      const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1)
      const [rows, fitted] = await Promise.all([
        listMovementsInRange({ from: new Date(`${from}T00:00:00`).toISOString(), to: end.toISOString() }),
        listTyreIssuesInRange({ from, to, country }).catch(() => null),
      ])
      setMovements(rows); setIssues(fitted)
    } catch (err) { setMovements([]); setIssues(null); setError(toUserMessage(err, t('wmsissue.movements.loadError'))) }
    finally { setLoading(false) }
    // t is read only for messages; a language switch must not re-read the ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, country])
  useEffect(() => { load() }, [load])

  // Only the items on screen: the register is already country scoped, and a site filter narrows it further.
  const scoped = useMemo(() => {
    const ids = new Set((records || []).filter(r => !site || site === 'all' || r.site === site).map(r => r.id))
    return movements.filter(m => ids.has(m.stock_id))
  }, [movements, records, site])
  const ledger = useMemo(() => summarizeLedger(scoped), [scoped])
  const days = useMemo(() => dailyLedger(scoped), [scoped])
  const fitted = issues ? tyresFitted(site && site !== 'all' ? issues.filter(i => i.site === site) : issues) : null
  const gap = fitted == null ? null : utilisationGap(fitted, ledger.totals.utilised)

  const itemColumns = useMemo(() => [
    { accessorKey: 'site', header: t('wmsissue.filters.site') },
    { accessorKey: 'description', header: t('wmsissue.cols.item') },
    { accessorKey: 'opening', header: t('wmsissue.movements.opening'), cell: ({ getValue }) => getValue() ?? na },
    { accessorKey: 'received', header: t('wmsissue.movements.received'), cell: ({ getValue }) => <span className="tabular-nums text-green-500" dir="ltr">{getValue() ? '+' + getValue() : 0}</span> },
    { accessorKey: 'utilised', header: t('wmsissue.movements.utilised'), cell: ({ getValue }) => <span className="tabular-nums text-red-500" dir="ltr">{getValue() ? '-' + getValue() : 0}</span> },
    { accessorKey: 'countAdj', header: t('wmsissue.movements.countCorrection'), cell: ({ getValue }) => <span className={'tabular-nums ' + tone(getValue())} dir="ltr">{signed(getValue())}</span> },
    { accessorKey: 'otherAdj', header: t('wmsissue.movements.otherAdjustments'), cell: ({ getValue }) => <span className={'tabular-nums ' + tone(getValue())} dir="ltr">{signed(getValue())}</span> },
    { accessorKey: 'closing', header: t('wmsissue.movements.closing'), cell: ({ getValue }) => <strong className="tabular-nums">{getValue() ?? na}</strong> },
  ], [t, na])
  const dayColumns = useMemo(() => [
    { accessorKey: 'date', header: t('wmsissue.cols.date') },
    { accessorKey: 'received', header: t('wmsissue.movements.received'), cell: ({ getValue }) => <span className="tabular-nums text-green-500" dir="ltr">{getValue() ? '+' + getValue() : 0}</span> },
    { accessorKey: 'utilised', header: t('wmsissue.movements.utilised'), cell: ({ getValue }) => <span className="tabular-nums text-red-500" dir="ltr">{getValue() ? '-' + getValue() : 0}</span> },
    { accessorKey: 'countAdj', header: t('wmsissue.movements.countCorrection'), cell: ({ getValue }) => <span className={'tabular-nums ' + tone(getValue())} dir="ltr">{signed(getValue())}</span> },
    { accessorKey: 'otherAdj', header: t('wmsissue.movements.otherAdjustments'), cell: ({ getValue }) => <span className={'tabular-nums ' + tone(getValue())} dir="ltr">{signed(getValue())}</span> },
    { accessorKey: 'net', header: t('wmsissue.movements.netChange'), cell: ({ getValue }) => <strong className={'tabular-nums ' + tone(getValue())} dir="ltr">{signed(getValue())}</strong> },
  ], [t])

  const exportExcel = async () => {
    const { exportToExcel } = await import('../../lib/exportUtils')
    const keys = ['site', 'description', 'opening', 'received', 'utilised', 'countAdj', 'otherAdj', 'closing']
    exportToExcel(ledger.rows.map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? 'N/A']))), keys,
      ['Site', 'Item', 'Opening', 'Received', 'Utilised', 'Count correction', 'Other adjustments', 'Closing'],
      `Stock movements ${from} to ${to}`, 'Movements')
  }

  return <div className="space-y-4">
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-xs text-[var(--text-secondary)]"><span>{t('wmsissue.filters.from')}</span><DateField className="mt-1 w-44" ariaLabel={t('wmsissue.filters.from')} value={from} onChange={setFrom} placeholder={t('wmsissue.movements.selectDate')} /></div>
        <div className="text-xs text-[var(--text-secondary)]"><span>{t('wmsissue.movements.through')}</span><DateField className="mt-1 w-44" ariaLabel={t('wmsissue.movements.through')} value={to} onChange={setTo} min={from} placeholder={t('wmsissue.movements.selectDate')} /></div>
        <button type="button" className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> {t('wmsissue.common.refresh')}</button>
        <button type="button" className="btn-secondary" onClick={exportExcel} disabled={loading || !ledger.rows.length}><Download size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label={t('wmsissue.movements.quickRanges')}>
        {PRESETS.map(([key, back]) => <button key={key} type="button" className="rounded-md border border-[var(--border-dim)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
          onClick={() => { const d = new Date(); setTo(localDay(d)); setFrom(localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back))) }}>{t(`wmsissue.movements.presets.${key}`)}</button>)}
      </div>
    </Card>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {loading ? <p role="status" className="text-sm text-[var(--text-muted)] py-6">{t('wmsissue.movements.loading')}</p> : <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label={t('wmsissue.movements.received')} value={ledger.totals.received} valueClass="text-green-500" hint={t('wmsissue.movements.receivedHint')} />
        <Tile label={t('wmsissue.movements.utilised')} value={ledger.totals.utilised} valueClass="text-red-500" hint={t('wmsissue.movements.utilisedHint')} />
        <Tile label={t('wmsissue.movements.countCorrections')} value={signed(ledger.totals.countAdj)} valueClass={tone(ledger.totals.countAdj)} hint={t('wmsissue.movements.countCorrectionsHint')} />
        <Tile label={t('wmsissue.movements.otherAdjustments')} value={signed(ledger.totals.otherAdj)} valueClass={tone(ledger.totals.otherAdj)} />
        <Tile label={t('wmsissue.movements.tyresFitted')} value={fitted ?? na} hint={t('wmsissue.movements.tyresFittedHint')} />
      </div>
      {gap?.note && <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{gap.note}</p>}
      {ledger.unknownTypes.length > 0 && <p role="note" className="text-xs text-amber-500">{t('wmsissue.movements.unknownTypes', { types: ledger.unknownTypes.join(', ') })}</p>}
      <Card>
        <h3 className="font-semibold mb-3">{t('wmsissue.movements.byItem')}</h3>
        <EnterpriseTable columns={itemColumns} data={ledger.rows} getRowId={(r) => r.stockId} enableColumnVisibility={false} enableExport={false} emptyMessage={t('wmsissue.movements.empty')} />
      </Card>
      <Card>
        <h3 className="font-semibold mb-3">{t('wmsissue.movements.byDay')}</h3>
        <EnterpriseTable columns={dayColumns} data={days} getRowId={(r) => r.date} enableGlobalFilter={false} enableColumnFilters={false} enableColumnVisibility={false} enableExport={false} emptyMessage={t('wmsissue.movements.empty')} />
      </Card>
    </>}
  </div>
}
