/**
 * Valuation section: owned value, the cost-reconciliation work queue and the
 * read-only ERP reconciliation.
 *
 * OWNER RULE: unknown cost is never zero and never invented. The headline
 * shows valued quantity, unvalued quantity and a completeness flag per
 * currency; a valued amount with unvalued stock beside it is labelled
 * "valued part", never "total". Currencies are never added together.
 * Inventory value is balance-sheet only: nothing here creates an accounting
 * posting or touches parts_consumption.
 */
import { useMemo, useState } from 'react'
import { Coins, PackageX, CheckCircle2, AlertTriangle, HelpCircle, FileSpreadsheet, ClipboardList, Save, XCircle } from 'lucide-react'
import { Tabs, KitTable } from '../commandCenter/kit'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import {
  loadValuation, loadBalanceSnapshot, listCostReconciliations, reconcileCost, newIdempotencyKey,
  listErpReconciliation, loadErpReconciliationRows, ERP_RECON_STATUSES, SNAPSHOT_MAX,
} from '../../lib/api/inventory'
import {
  normaliseValuationRow, summariseValuation, valuationFromBalances, valueLabelKey,
  normaliseCostReconciliation, normaliseErpRow, ERP_STATUS_TONE, erpExportRows, ERP_EXPORT_COLUMNS,
} from '../../lib/inventory/integrationView'
import { makeReportRef, describeFilters } from '../../lib/inventory/reportCatalog'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import {
  useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, Denied, alignNumeric, ExplainedKpi, PagedTable, SearchBox,
  StatusPill, Field, fmtDateTime,
} from './InvUi'
import { RequestApprovalButton } from './ApprovalsPanel'

const COMPLETE_ICON = { true: CheckCircle2, false: AlertTriangle, null: HelpCircle }

function CompleteFlag({ complete }) {
  const { t } = useLanguage()
  const Icon = COMPLETE_ICON[String(complete)]
  const tone = complete === true ? 'good' : complete === false ? 'warn' : 'muted'
  const label = complete === true ? t('inventory.valuation.complete') : complete === false ? t('inventory.valuation.incomplete') : t('inventory.valuation.completenessUnknown')
  return <span className={`cc-pill ${tone} inv-flag`}><Icon size={12} aria-hidden="true" /> {label}</span>
}

/** v_inv_valuation, falling back to v_inv_balances when the view is not installed. */
function useValuation(scope) {
  return useInvQuery(async () => {
    const v = await loadValuation(scope)
    if (v.status === 'ok') return { ...v, source: 'view', rows: v.rows.map(normaliseValuationRow) }
    const b = await loadBalanceSnapshot(scope)
    if (b.status !== 'ok') return { status: 'not_provisioned', rows: [], truncated: false }
    return { ...b, source: 'balances', rows: valuationFromBalances(b.rows) }
  }, [scope.country, scope.site])
}

function ValuationOverview({ scope }) {
  const { t } = useLanguage()
  const q = useValuation(scope)
  const rows = useMemo(() => q.data?.rows || [], [q.data])
  const sum = useMemo(() => summariseValuation(rows), [rows])
  if (q.error) return <ErrorNote error={q.error} onRetry={q.retry} />
  if (q.data?.status === 'not_provisioned') return <NotSetUp what={t('inventory.valuation.viewName')} />
  const loading = q.loading && !q.data
  const headline = sum.currencies.filter((c) => c.currency)
  const display = headline.length === 0 ? 'N/A'
    : headline.map((c) => (c.valuedAmount === null ? `${c.currency} N/A` : formatMoney(c.valuedAmount, c.currency))).join(' | ')

  return (
    <div className="inv-hub">
      <div className="inv-kpis">
        <ExplainedKpi metricId="inv_stock_value" country={scope.country} icon={Coins} tone="t-green" loading={loading}
          display={display} label={t(`inventory.valuation.${valueLabelKey(sum.complete)}`)} />
        <ExplainedKpi metricId="inv_unvalued_stock" country={scope.country} icon={PackageX} tone="t-amber" loading={loading}
          display={sum.unvaluedQty === null ? 'N/A' : formatQty(sum.unvaluedQty)} label={t('inventory.valuation.unvaluedQty')} />
        <ExplainedKpi icon={ClipboardList} tone="t-blue" loading={loading}
          display={sum.openReconciliations === null ? 'N/A' : formatQty(sum.openReconciliations)} label={t('inventory.valuation.openRecon')} />
      </div>
      <div className="inv-actions"><CompleteFlag complete={sum.complete} /></div>
      {sum.complete === false && <Note tone="warn">{t('inventory.valuation.incompleteNote')}</Note>}
      {sum.mixedCurrency && <Note>{t('inventory.valuation.mixed')}</Note>}
      {q.data?.source === 'balances' && <Note>{t('inventory.valuation.fromBalances')}</Note>}
      {q.data?.truncated && <Note tone="warn">{t('inventory.state.truncated')}</Note>}
      <Note>{t('inventory.valuation.method')}</Note>
      <SectionCard title={t('inventory.valuation.byCurrency')} sub={t('inventory.valuation.byCurrencySub')}>
        <KitTable compact rows={sum.currencies.map((c) => ({ ...c, key: c.currency || 'none' }))} loading={loading}
          empty={t('inventory.valuation.empty')} columns={alignNumeric([
            { key: 'currency', header: t('inventory.common.currency'), cell: (r) => r.currency || <span className="cc-na">{t('inventory.valuation.noCurrency')}</span> },
            { key: 'valuedQty', header: t('inventory.valuation.valuedQty'), numeric: true, cell: (r) => formatQty(r.valuedQty) },
            { key: 'unvaluedQty', header: t('inventory.valuation.unvaluedQty'), numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
            { key: 'valuedAmount', header: t('inventory.valuation.valuedAmount'), numeric: true, cell: (r) => (r.valuedAmount === null ? 'N/A' : formatMoney(r.valuedAmount, r.currency)) },
            { key: 'complete', header: t('inventory.valuation.completeness'), cell: (r) => <CompleteFlag complete={r.complete} /> },
          ])} />
      </SectionCard>
      <SectionCard title={t('inventory.valuation.bySite')} sub={t('inventory.valuation.bySiteSub')}>
        <div className="inv-scroll">
          <KitTable compact rows={rows} loading={loading} empty={t('inventory.valuation.empty')} columns={alignNumeric([
            { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.site || r.location || <span className="cc-na">N/A</span> },
            { key: 'currency', header: t('inventory.common.currency'), cell: (r) => r.currency || <span className="cc-na">{t('inventory.valuation.noCurrency')}</span> },
            { key: 'valuedQty', header: t('inventory.valuation.valuedQty'), numeric: true, cell: (r) => formatQty(r.valuedQty) },
            { key: 'unvaluedQty', header: t('inventory.valuation.unvaluedQty'), numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
            { key: 'valuedAmount', header: t('inventory.valuation.valuedAmount'), numeric: true, cell: (r) => (r.valuedAmount === null ? 'N/A' : formatMoney(r.valuedAmount, r.currency)) },
            { key: 'complete', header: t('inventory.valuation.completeness'), cell: (r) => <CompleteFlag complete={r.complete} /> },
          ])} />
        </div>
      </SectionCard>
    </div>
  )
}

const RECON_TONE = { open: 'warning', proposed: 'info', submitted: 'info', approved: 'good', resolved: 'good', rejected: 'muted' }

function CostReconciliationQueue({ scope, can }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('open')
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const q = useInvQuery(() => listCostReconciliations({ ...scope, page, pageSize, status }), [scope.country, scope.site, page, pageSize, status])
  const shaped = q.data ? { ...q.data, rows: (q.data.rows || []).map(normaliseCostReconciliation) } : q.data
  const canPropose = can('financial_post') || can('view_value')

  const openRow = (r) => {
    setErr('')
    setOpen({ row: r, unitCost: r.proposedCost ?? '', currency: r.currency || '', source: r.source || '', evidence: '', note: '', key: newIdempotencyKey(), rejectKey: newIdempotencyKey() })
  }
  const run = async (decision) => {
    setBusy(true); setErr('')
    try {
      await reconcileCost({
        reconciliationId: open.row.id, stockId: open.row.stockId, unitCost: open.unitCost, currency: open.currency,
        source: open.source, evidence: open.evidence, note: open.note, decision,
      }, decision === 'propose' ? open.key : open.rejectKey)
      setOpen(null); q.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="inv-hub">
      <Note>{t('inventory.costRecon.rule')}</Note>
      <label className="cc-field" style={{ maxWidth: 220 }}>
        <span>{t('inventory.common.status')}</span>
        <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="open">{t('inventory.costRecon.openOnly')}</option>
          <option value="all">{t('inventory.common.all')}</option>
        </select>
      </label>
      <PagedTable query={{ ...q, data: shaped }} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
        empty={t('inventory.costRecon.empty')} what={t('inventory.costRecon.title')} noun={t('inventory.supply.linesNoun')} onRowClick={openRow}
        columns={[
          { key: 'itemCode', header: t('inventory.common.item'), cell: (r) => r.itemCode || r.description || <span className="cc-na">N/A</span> },
          { key: 'location', header: t('inventory.common.location'), cell: (r) => r.location || <span className="cc-na">N/A</span> },
          { key: 'unvaluedQty', header: t('inventory.valuation.unvaluedQty'), numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
          { key: 'proposedCost', header: t('inventory.costRecon.proposedCost'), numeric: true, cell: (r) => (r.proposedCost === null ? <span className="cc-na">{t('inventory.costRecon.noCost')}</span> : formatMoney(r.proposedCost, r.currency)) },
          { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={RECON_TONE[r.status] || 'muted'} /> },
          { key: 'createdAt', header: t('inventory.common.created'), cell: (r) => fmtDateTime(r.createdAt) },
        ]} />

      <SideDrawer className="cc inv-panel" open={!!open} onClose={() => !busy && setOpen(null)} busy={busy} size="md"
        title={t('inventory.costRecon.drawerTitle')} subtitle={open ? `${open.row.itemCode || ''} | ${open.row.location || ''}` : ''}
        closeLabel={t('inventory.actions.close')}>
        {open && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <dl className="inv-dl">
              <dt>{t('inventory.valuation.unvaluedQty')}</dt><dd className="inv-num">{formatQty(open.row.unvaluedQty)}</dd>
              <dt>{t('inventory.common.status')}</dt><dd><StatusPill value={open.row.status} tone={RECON_TONE[open.row.status] || 'muted'} /></dd>
            </dl>
            {!canPropose ? <Note>{t('inventory.costRecon.readOnly')}</Note> : (
              <>
                <div className="inv-form">
                  <Field label={t('inventory.costRecon.unitCost')}>
                    <input className="inv-input inv-num" type="number" min="0" step="any" value={open.unitCost}
                      onChange={(e) => setOpen((o) => ({ ...o, unitCost: e.target.value }))} />
                  </Field>
                  <Field label={t('inventory.common.currency')}>
                    <input className="inv-input" maxLength={3} value={open.currency} onChange={(e) => setOpen((o) => ({ ...o, currency: e.target.value.toUpperCase() }))} />
                  </Field>
                  <Field label={t('inventory.costRecon.source')} full>
                    <input className="inv-input" maxLength={200} value={open.source} placeholder={t('inventory.costRecon.sourceHint')}
                      onChange={(e) => setOpen((o) => ({ ...o, source: e.target.value }))} />
                  </Field>
                  <Field label={t('inventory.costRecon.evidence')} full>
                    <textarea className="inv-input" maxLength={2000} value={open.evidence} onChange={(e) => setOpen((o) => ({ ...o, evidence: e.target.value }))} />
                  </Field>
                </div>
                <p className="cc-card-sub">{t('inventory.costRecon.noZero')}</p>
                <div className="inv-actions">
                  <button type="button" className="cc-btn-primary" disabled={busy} onClick={() => run('propose')}><Save size={14} aria-hidden="true" /> {t('inventory.costRecon.propose')}</button>
                  <button type="button" className="cc-btn-ghost" disabled={busy || !open.note.trim()} onClick={() => run('reject')}><XCircle size={14} aria-hidden="true" /> {t('inventory.disc.reject')}</button>
                </div>
                <Field label={t('inventory.disc.decisionNote')} full>
                  <textarea className="inv-input" maxLength={1000} value={open.note} onChange={(e) => setOpen((o) => ({ ...o, note: e.target.value }))} />
                </Field>
                {open.row.id && <RequestApprovalButton entityType="cost_reconciliation" entityId={open.row.id} onDone={() => q.retry()} />}
              </>
            )}
            {err && <ErrorNote error={err} />}
          </div>
        )}
      </SideDrawer>
    </div>
  )
}

function ErpReconciliationPanel({ scope, can }) {
  const { t } = useLanguage()
  const { appSettings } = useSettings()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('differences')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [last, setLast] = useState(null)
  const filters = { ...scope, status, search }
  const q = useInvQuery(() => listErpReconciliation({ ...filters, page, pageSize }), [scope.country, scope.site, status, search, page, pageSize])
  const shaped = q.data ? { ...q.data, rows: (q.data.rows || []).map(normaliseErpRow) } : q.data

  const exportXlsx = async () => {
    setBusy(true); setErr('')
    try {
      const res = await loadErpReconciliationRows(filters)
      if (res.status === 'not_provisioned') { setErr(t('inventory.reports.notSetUp')); return }
      const now = new Date()
      const ref = makeReportRef('erp', now)
      const filterText = `${describeFilters({ country: scope.country || 'All', site: scope.site })} | Status: ${status} | Search: ${search || 'none'}`
      const { exportToExcel, reportFileName } = await import('../../lib/exportUtils')
      await exportToExcel(erpExportRows(res.rows), ERP_EXPORT_COLUMNS.map(([k]) => k), ERP_EXPORT_COLUMNS.map(([, h]) => h),
        reportFileName('Inventory', 'ERP reconciliation', ref), 'ERP reconciliation', {
          title: `ERP reconciliation (${ref})`, company: appSettings?.company_name || '',
          meta: { 'Report reference': ref, Filters: filterText, 'Snapshot taken': fmtDateTime(now), Truncated: res.truncated ? `Yes, first ${SNAPSHOT_MAX} rows` : 'No', Posting: 'None (read-only comparison)' },
        })
      setLast({ ref, rows: res.rows.length, truncated: res.truncated })
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="inv-hub">
      <Note>{t('inventory.erp.rule')}</Note>
      <div className="cc-filters">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }} placeholder={t('inventory.erp.search')} />
        <label className="cc-field">
          <span>{t('inventory.common.status')}</span>
          <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="differences">{t('inventory.erp.differencesOnly')}</option>
            <option value="all">{t('inventory.common.all')}</option>
            {ERP_RECON_STATUSES.map((s) => <option key={s} value={s}>{t(`inventory.erp.status.${s}`)}</option>)}
          </select>
        </label>
        {can('export') && (
          <button type="button" className="cc-btn-ghost" disabled={busy} onClick={exportXlsx}>
            <FileSpreadsheet size={14} aria-hidden="true" /> {busy ? t('inventory.reports.building') : t('inventory.actions.excel')}
          </button>
        )}
      </div>
      <PagedTable query={{ ...q, data: shaped }} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
        empty={t('inventory.erp.empty')} what={t('inventory.erp.title')} noun={t('inventory.supply.linesNoun')}
        columns={[
          { key: 'itemCode', header: t('inventory.common.item'), cell: (r) => r.itemCode || r.description || <span className="cc-na">N/A</span> },
          { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.site || <span className="cc-na">N/A</span> },
          { key: 'invQty', header: t('inventory.erp.invQty'), numeric: true, cell: (r) => formatQty(r.invQty) },
          { key: 'erpQty', header: t('inventory.erp.erpQty'), numeric: true, cell: (r) => formatQty(r.erpQty) },
          { key: 'qtyDiff', header: t('inventory.erp.qtyDiff'), numeric: true, cell: (r) => (r.qtyDiff === null ? <span className="cc-na">N/A</span> : `${r.qtyDiff > 0 ? '+' : ''}${formatQty(r.qtyDiff)}`) },
          ...(can('view_value') ? [
            { key: 'invValue', header: t('inventory.erp.invValue'), numeric: true, cell: (r) => formatMoney(r.invValue, r.currency) },
            { key: 'erpValue', header: t('inventory.erp.erpValue'), numeric: true, cell: (r) => formatMoney(r.erpValue, r.currency) },
            { key: 'valueDiff', header: t('inventory.erp.valueDiff'), numeric: true, cell: (r) => formatMoney(r.valueDiff, r.currency) },
          ] : []),
          { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={ERP_STATUS_TONE[r.status] || 'muted'} label={ERP_STATUS_TONE[r.status] ? t(`inventory.erp.status.${r.status === 'unknown' ? 'unknown' : r.status}`) : undefined} /> },
        ]} />
      {err && <ErrorNote error={err} />}
      {last && <Note tone={last.truncated ? 'warn' : 'good'} title={t('inventory.reports.done', { ref: last.ref })}>{t('inventory.erp.exported', { rows: last.rows })}</Note>}
    </div>
  )
}

export default function ValuationSection({ scope, can }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState('value')
  if (!can('view_value')) return <Denied capLabel={t('inventory.caps.view_value')} />
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.valuation')} value={tab} onChange={setTab} tabs={[
        { key: 'value', label: t('inventory.valuation.tabs.value') },
        { key: 'costs', label: t('inventory.valuation.tabs.costs') },
        { key: 'erp', label: t('inventory.valuation.tabs.erp') },
      ]} />
      {tab === 'value' && <ValuationOverview scope={scope} />}
      {tab === 'costs' && <CostReconciliationQueue scope={scope} can={can} />}
      {tab === 'erp' && <ErpReconciliationPanel scope={scope} can={can} />}
    </div>
  )
}
