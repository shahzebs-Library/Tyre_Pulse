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
import { Coins, PackageX, CheckCircle2, AlertTriangle, HelpCircle, FileSpreadsheet, ClipboardList, Save, Scale, Split } from 'lucide-react'
import { Tabs, KitTable } from '../commandCenter/kit'
import SideDrawer from '../ui/SideDrawer'
import { useLanguage } from '../../contexts/LanguageContext'
import { useSettings } from '../../contexts/SettingsContext'
import {
  loadValuation, loadBalanceSnapshot, listCostReconciliations, reconcileCost, newIdempotencyKey, COST_RECON_STATUSES,
  listErpReconciliation, loadErpReconciliationRows, ERP_RECON_STATUSES, SNAPSHOT_MAX,
} from '../../lib/api/inventory'
import {
  normaliseValuationRow, summariseValuation, valuationFromBalances, valueLabelKey, pendingOf,
  normaliseCostReconciliation, COST_RECON_TONE, normaliseErpRow, ERP_STATUS_TONE, erpExportRows, ERP_EXPORT_COLUMNS,
} from '../../lib/inventory/integrationView'
import { makeReportRef, describeFilters } from '../../lib/inventory/reportCatalog'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import {
  useInvQuery, ErrorNote, NotSetUp, Note, SectionCard, Denied, alignNumeric, ExplainedKpi, PagedTable, SearchBox,
  StatusPill, Field, fmtDateTime, useHubTab,
} from './InvUi'
import { RequestApprovalButton, ApprovalState } from './ApprovalsPanel'

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
        <ExplainedKpi icon={Scale} tone="t-blue" loading={loading}
          display={formatQty(sum.currencies.reduce((a, c) => a + (c.valuedQty || 0), 0))} label={t('inventory.valuation.valuedQty')} />
        <ExplainedKpi metricId="inv_unvalued_stock" country={scope.country} icon={PackageX} tone="t-amber" loading={loading}
          display={sum.unvaluedQty === null ? 'N/A' : formatQty(sum.unvaluedQty)} label={t('inventory.valuation.unvaluedQty')} />
        <ExplainedKpi icon={Split} tone="t-purple" loading={loading}
          display={formatQty(sum.pendingAllocationQty)} label={t('inventory.valuation.pendingQty')} />
        <ExplainedKpi icon={ClipboardList} tone="t-blue" loading={loading}
          display={sum.openReconciliations === null ? 'N/A' : formatQty(sum.openReconciliations)} label={t('inventory.valuation.openRecon')} />
      </div>
      <div className="inv-actions"><CompleteFlag complete={sum.complete} /></div>
      {sum.complete === false && <Note tone="warn">{t('inventory.valuation.incompleteNote')}</Note>}
      {(sum.pendingAllocationQty > 0 || sum.openAllocations > 0) && <Note tone="warn">{t('inventory.valuation.pendingAllocation', { qty: formatQty(sum.pendingAllocationQty) })}</Note>}
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
            { key: 'pending', header: t('inventory.valuation.pendingQty'), numeric: true, cell: (r) => formatQty(r.pendingAllocationQty ?? pendingOf(r)) },
            { key: 'valuedAmount', header: t('inventory.valuation.valuedAmount'), numeric: true, cell: (r) => (r.valuedAmount === null ? 'N/A' : formatMoney(r.valuedAmount, r.currency)) },
            { key: 'complete', header: t('inventory.valuation.completeness'), cell: (r) => <CompleteFlag complete={r.complete} /> },
          ])} />
      </SectionCard>
      <SectionCard title={t('inventory.valuation.bySite')} sub={t('inventory.valuation.bySiteSub')}>
        <div className="inv-scroll">
          <KitTable compact rows={rows} loading={loading} empty={t('inventory.valuation.empty')} columns={alignNumeric([
            { key: 'itemCode', header: t('inventory.common.item'), cell: (r) => r.itemCode || r.description || <span className="cc-na">N/A</span> },
            { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.site || <span className="cc-na">N/A</span> },
            { key: 'ownership', header: t('inventory.valuation.ownership'), cell: (r) => t(`inventory.valuation.own.${r.ownership || 'owned'}`) },
            { key: 'currency', header: t('inventory.common.currency'), cell: (r) => r.currency || <span className="cc-na">{t('inventory.valuation.noCurrency')}</span> },
            { key: 'valuedQty', header: t('inventory.valuation.valuedQty'), numeric: true, cell: (r) => formatQty(r.valuedQty) },
            { key: 'unvaluedQty', header: t('inventory.valuation.unvaluedQty'), numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
            { key: 'pending', header: t('inventory.valuation.pendingQty'), numeric: true, cell: (r) => formatQty(r.pendingAllocationQty ?? pendingOf(r)) },
            { key: 'valuedAmount', header: t('inventory.valuation.valuedAmount'), numeric: true, cell: (r) => (r.valuedAmount === null ? 'N/A' : formatMoney(r.valuedAmount, r.currency)) },
            { key: 'openReconciliations', header: t('inventory.valuation.openRecon'), numeric: true, cell: (r) => (r.openReconciliations === null ? <span className="cc-na">N/A</span> : formatQty(r.openReconciliations)) },
            { key: 'complete', header: t('inventory.valuation.completeness'), cell: (r) => <CompleteFlag complete={r.complete} /> },
          ])} />
        </div>
      </SectionCard>
    </div>
  )
}

/**
 * Cost reconciliation: the ONLY way unknown cost becomes known.
 * Step 1 propose (inv_request_approval, type cost_reconciliation, with the
 * evidenced unit cost or a write-off and a reason). Step 2 someone else decides
 * it in Controls > Approvals. Step 3 post the approved result
 * (inv_cost_reconcile), which applies exactly the approved proposal.
 * A direct cost assignment through the ledger is refused by the server.
 */
function CostReconciliationQueue({ scope, can, userId }) {
  const { t } = useLanguage()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState('open')
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [stateKey, setStateKey] = useState(0)
  const q = useInvQuery(() => listCostReconciliations({ ...scope, page, pageSize, status }), [scope.country, scope.site, page, pageSize, status])
  const shaped = q.data ? { ...q.data, rows: (q.data.rows || []).map(normaliseCostReconciliation) } : q.data
  const canPropose = can('financial_post') || can('view_value')
  const canPost = can('financial_post')

  const openRow = (r) => {
    setErr('')
    setOpen({ row: r, resolution: 'resolved', unitCost: r.proposedCost ?? '', valuedQty: r.proposedValuedQty ?? '', reason: '', evidence: '', note: '', postKey: newIdempotencyKey() })
  }
  const post = async () => {
    setBusy(true); setErr('')
    try {
      await reconcileCost({ reconciliationId: open.row.id, note: open.note, evidence: open.evidence }, open.postKey)
      setOpen(null); q.retry()
    } catch (e) { setErr(toUserMessage(e)) } finally { setBusy(false) }
  }
  const costText = open?.unitCost === '' ? '' : open?.unitCost
  const allocation = !!open?.row.isAllocation
  const proposal = open && allocation
    ? (open.valuedQty === '' ? null : { valued_qty: open.valuedQty, max_qty: open.row.allocationQty })
    : open && (open.resolution === 'written_off'
    ? { resolution: 'written_off' }
    : (costText === '' || costText === null || costText === undefined ? null : { resolution: 'resolved', unit_cost: costText }))
  const isOpen = open?.row.status === 'open'
  const isCreator = open && userId && open.row.createdBy === userId

  return (
    <div className="inv-hub">
      <Note>{t('inventory.costRecon.rule')}</Note>
      <label className="cc-field" style={{ maxWidth: 220 }}>
        <span>{t('inventory.common.status')}</span>
        <select className="cc-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          {COST_RECON_STATUSES.map((s) => <option key={s} value={s}>{t(`inventory.costRecon.status.${s}`)}</option>)}
          <option value="all">{t('inventory.common.all')}</option>
        </select>
      </label>
      <PagedTable query={{ ...q, data: shaped }} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }}
        empty={t('inventory.costRecon.empty')} what={t('inventory.costRecon.title')} noun={t('inventory.supply.linesNoun')} onRowClick={openRow}
        columns={[
          { key: 'itemCode', header: t('inventory.common.item'), cell: (r) => r.itemCode || <span className="cc-na">N/A</span> },
          { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.site || <span className="cc-na">N/A</span> },
          { key: 'kind', header: t('inventory.costRecon.kind'), cell: (r) => (r.kind ? t(`inventory.costRecon.kinds.${r.kind}`) : <span className="cc-na">N/A</span>) },
          { key: 'unvaluedQty', header: t('inventory.valuation.unvaluedQty'), numeric: true, cell: (r) => formatQty(r.unvaluedQty) },
          { key: 'proposedCost', header: t('inventory.costRecon.proposedCost'), numeric: true, cell: (r) => (r.isAllocation
            ? (r.proposedValuedQty === null ? <span className="cc-na">{t('inventory.costRecon.noSplit')}</span> : t('inventory.costRecon.splitShort', { valued: formatQty(r.proposedValuedQty), total: formatQty(r.allocationQty) }))
            : r.proposedResolution === 'written_off' ? t('inventory.costRecon.writeOff')
            : r.proposedCost === null ? <span className="cc-na">{t('inventory.costRecon.noCost')}</span> : formatMoney(r.proposedCost, r.currency)) },
          { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={COST_RECON_TONE[r.status] || 'muted'} label={t(`inventory.costRecon.status.${r.status}`)} /> },
          { key: 'createdAt', header: t('inventory.common.created'), cell: (r) => fmtDateTime(r.createdAt) },
        ]} />

      <SideDrawer className="cc inv-panel" open={!!open} onClose={() => !busy && setOpen(null)} busy={busy} size="md"
        title={t('inventory.costRecon.drawerTitle')} subtitle={open ? [open.row.itemCode, open.row.site].filter(Boolean).join(' | ') : ''}
        closeLabel={t('inventory.actions.close')}>
        {open && (
          <div className="inv-hub" style={{ gap: 12 }}>
            <dl className="inv-dl">
              <dt>{t(allocation ? 'inventory.valuation.pendingQty' : 'inventory.valuation.unvaluedQty')}</dt><dd className="inv-num">{formatQty(allocation ? open.row.allocationQty : open.row.unvaluedQty)}</dd>
              <dt>{t('inventory.costRecon.kind')}</dt><dd>{open.row.kind ? t(`inventory.costRecon.kinds.${open.row.kind}`) : 'N/A'}</dd>
              <dt>{t('inventory.common.currency')}</dt><dd>{open.row.currency || 'N/A'}</dd>
              <dt>{t('inventory.common.status')}</dt><dd><StatusPill value={open.row.status} tone={COST_RECON_TONE[open.row.status] || 'muted'} label={t(`inventory.costRecon.status.${open.row.status}`)} /></dd>
              {open.row.resolvedCost !== null && (<><dt>{t('inventory.costRecon.resolvedCost')}</dt><dd className="inv-num">{formatMoney(open.row.resolvedCost, open.row.currency)}</dd></>)}
            </dl>
            {open.row.consumed && !allocation && <Note>{t('inventory.costRecon.consumedNote')}</Note>}
            {allocation && (
              <>
                <Note tone="warn">{t('inventory.costRecon.allocationRule')}</Note>
                {open.row.snapshot && (
                  <dl className="inv-dl">
                    <dt>{t('inventory.costRecon.snapshotValued')}</dt><dd className="inv-num">{formatQty(open.row.snapshot.valued_qty)}</dd>
                    <dt>{t('inventory.costRecon.snapshotUnvalued')}</dt><dd className="inv-num">{formatQty(open.row.snapshot.unvalued_qty)}</dd>
                  </dl>
                )}
                {open.row.holderStockId && <p className="cc-card-sub">{t('inventory.costRecon.heldElsewhere')}</p>}
                {open.row.resolvedValuedQty !== null && (
                  <p className="cc-card-sub">{t('inventory.costRecon.decidedSplit', { valued: formatQty(open.row.resolvedValuedQty), unvalued: formatQty(open.row.resolvedUnvaluedQty) })}</p>
                )}
              </>
            )}
            {!isOpen ? <Note>{t('inventory.costRecon.closedNote')}</Note> : !canPropose ? <Note>{t('inventory.costRecon.readOnly')}</Note> : (
              <>
                <h4 className="cc-card-title">{t('inventory.costRecon.step1')}</h4>
                {isCreator && <Note tone="warn">{t('inventory.costRecon.creatorNote')}</Note>}
                <div className="inv-form">
                  {allocation ? (
                    <Field label={t('inventory.costRecon.valuedQty', { total: formatQty(open.row.allocationQty) })}>
                      <input className="inv-input inv-num" type="number" min="0" max={open.row.allocationQty ?? undefined} step="any" value={open.valuedQty}
                        onChange={(e) => setOpen((o) => ({ ...o, valuedQty: e.target.value }))} />
                    </Field>
                  ) : (<>
                  <Field label={t('inventory.costRecon.resolution')}>
                    <select className="cc-select" value={open.resolution} onChange={(e) => setOpen((o) => ({ ...o, resolution: e.target.value }))}>
                      <option value="resolved">{t('inventory.costRecon.resolveWithCost')}</option>
                      <option value="written_off">{t('inventory.costRecon.writeOff')}</option>
                    </select>
                  </Field>
                  {open.resolution === 'resolved' && (
                    <Field label={`${t('inventory.costRecon.unitCost')} (${open.row.currency || 'N/A'})`}>
                      <input className="inv-input inv-num" type="number" min="0" step="any" value={open.unitCost}
                        onChange={(e) => setOpen((o) => ({ ...o, unitCost: e.target.value }))} />
                    </Field>
                  )}
                  </>)}
                  <Field label={t('inventory.costRecon.source')} full>
                    <input className="inv-input" maxLength={300} value={open.reason} placeholder={t('inventory.costRecon.sourceHint')}
                      onChange={(e) => setOpen((o) => ({ ...o, reason: e.target.value }))} />
                  </Field>
                  <Field label={t('inventory.costRecon.evidence')} full>
                    <textarea className="inv-input" maxLength={2000} value={open.evidence} onChange={(e) => setOpen((o) => ({ ...o, evidence: e.target.value }))} />
                  </Field>
                </div>
                <p className="cc-card-sub">{t(allocation ? 'inventory.costRecon.splitHint' : 'inventory.costRecon.noZero')}</p>
                <ApprovalState entityType="cost_reconciliation" entityId={open.row.id} refreshKey={stateKey} />
                <RequestApprovalButton entityType="cost_reconciliation" entityId={open.row.id} proposal={proposal}
                  reason={open.reason} evidence={open.evidence} disabled={!proposal}
                  label={t('inventory.costRecon.propose')} onDone={() => { setStateKey((k) => k + 1); q.retry() }} />
                <h4 className="cc-card-title">{t('inventory.costRecon.step2')}</h4>
                <p className="cc-card-sub">{t('inventory.costRecon.step2Body')}</p>
                <h4 className="cc-card-title">{t('inventory.costRecon.step3')}</h4>
                {canPost ? (
                  <>
                    <Field label={t('inventory.disc.decisionNote')} full>
                      <textarea className="inv-input" maxLength={1000} value={open.note} onChange={(e) => setOpen((o) => ({ ...o, note: e.target.value }))} />
                    </Field>
                    <div className="inv-actions">
                      <button type="button" className="cc-btn-primary" disabled={busy} onClick={post}><Save size={14} aria-hidden="true" /> {t('inventory.costRecon.post')}</button>
                    </div>
                  </>
                ) : <Note>{t('inventory.costRecon.needsFinancialPost')}</Note>}
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
          { key: 'month', header: t('inventory.erp.month'), cell: (r) => (r.month ? String(r.month).slice(0, 7) : <span className="cc-na">N/A</span>) },
          { key: 'itemCode', header: t('inventory.common.item'), cell: (r) => r.itemCode || <span className="cc-na">N/A</span> },
          { key: 'site', header: t('inventory.scope.site'), cell: (r) => r.site || <span className="cc-na">N/A</span> },
          { key: 'invQty', header: t('inventory.erp.invQty'), numeric: true, cell: (r) => formatQty(r.invQty) },
          { key: 'invUnvaluedQty', header: t('inventory.erp.invUnvaluedQty'), numeric: true, cell: (r) => formatQty(r.invUnvaluedQty) },
          { key: 'erpQty', header: t('inventory.erp.erpQty'), numeric: true, cell: (r) => formatQty(r.erpQty) },
          { key: 'qtyDiff', header: t('inventory.erp.qtyDiff'), numeric: true, cell: (r) => (r.qtyDiff === null ? <span className="cc-na">N/A</span> : `${r.qtyDiff > 0 ? '+' : ''}${formatQty(r.qtyDiff)}`) },
          ...(can('view_value') ? [
            { key: 'invValue', header: t('inventory.erp.invValue'), numeric: true, cell: (r) => formatMoney(r.invValue, r.currency) },
            { key: 'erpValue', header: t('inventory.erp.erpValue'), numeric: true, cell: (r) => formatMoney(r.erpValue, r.currency) },
            { key: 'valueDiff', header: t('inventory.erp.valueDiff'), numeric: true, cell: (r) => formatMoney(r.valueDiff, r.currency) },
          ] : []),
          { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone={ERP_STATUS_TONE[r.status] || 'muted'} label={ERP_STATUS_TONE[r.status] ? t(`inventory.erp.status.${r.status}`) : undefined} /> },
        ]} />
      {err && <ErrorNote error={err} />}
      {last && <Note tone={last.truncated ? 'warn' : 'good'} title={t('inventory.reports.done', { ref: last.ref })}>{t('inventory.erp.exported', { rows: last.rows })}</Note>}
    </div>
  )
}

const VALUATION_TABS = ['value', 'costs', 'erp']

export default function ValuationSection({ scope, can, userId, tab: linkedTab, onTab }) {
  const { t } = useLanguage()
  const [tab, setTab] = useHubTab(linkedTab, onTab, VALUATION_TABS, 'value')
  if (!can('view_value')) return <Denied capLabel={t('inventory.caps.view_value')} />
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.valuation')} value={tab} onChange={setTab} tabs={[
        { key: 'value', label: t('inventory.valuation.tabs.value') },
        { key: 'costs', label: t('inventory.valuation.tabs.costs') },
        { key: 'erp', label: t('inventory.valuation.tabs.erp') },
      ]} />
      {tab === 'value' && <ValuationOverview scope={scope} />}
      {tab === 'costs' && <CostReconciliationQueue scope={scope} can={can} userId={userId} />}
      {tab === 'erp' && <ErpReconciliationPanel scope={scope} can={can} />}
    </div>
  )
}
