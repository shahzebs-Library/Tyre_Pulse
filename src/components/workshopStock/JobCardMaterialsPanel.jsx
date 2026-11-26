/**
 * Job card materials: the whole workshop <-> warehouse flow for one job card.
 *
 *   request  -> check the store first: free stock is RESERVED for the job card,
 *               only the shortage becomes a requisition (no buying what is on the shelf)
 *   issue    -> one material issue slip (MIS) naming the job card, asset and receiver,
 *               posted to the ledger once (idempotent per line on the server)
 *   install  -> the workshop confirms what was fitted (optional note and signature);
 *               the person who issued cannot confirm their own issue
 *   return   -> unused parts go back to the stock line they came from, bounded by
 *               what is issued and not yet installed or returned
 *   reconcile-> issued - installed - returned = unreconciled, shown per line
 *   cost     -> from the issue movements, per currency; unvalued quantity is shown
 *               as unvalued, never as zero
 *
 * Every rule is enforced in the database (migrations 20261124091000 and
 * 20261124131000); this screen only decides what to offer.
 * Props: { scope, can, userId, onNavigate }.
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle, ClipboardList, Coins, FileDown, FileSpreadsheet, Package, PackageCheck,
  PackageMinus, Search, ShoppingCart, Undo2, Wrench,
} from 'lucide-react'
import { newIdempotencyKey } from '../../lib/api/inventory'
import {
  loadJobCardMaterials, findStockForRequest, reserveForJob, raiseShortageRequisition,
  issueReservedToJob, confirmInstallation, returnUnused,
} from '../../lib/workshopStock/service'
import {
  planRequest, validateInstall, validateReturn, JOB_MATERIAL_EXPORT_COLUMNS,
} from '../../lib/workshopStock/jobMaterials'
import { normaliseJobCard } from '../../lib/inventory/floorWorkflow'
import { formatMoney, formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import { Kpi, KitTable } from '../commandCenter/kit'
import SignaturePad from '../SignaturePad'
import { useLanguage } from '../../contexts/LanguageContext'
import { Field, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric, fmtDateTime } from '../inventory/InvUi'

const costText = (cost, na = 'N/A') => (cost?.length ? formatTotals(cost) : na)

export default function JobCardMaterialsPanel({ scope, can, onNavigate, initialJobCard = '' }) {
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const canIssue = typeof can === 'function' && can('issue')
  const canExport = typeof can === 'function' && can('export')
  const [jobCard, setJobCard] = useState(initialJobCard)
  const [state, setState] = useState({ loading: false, error: '', data: null })
  const [flash, setFlash] = useState(null)

  const load = async (jc = jobCard) => {
    const j = normaliseJobCard(jc)
    if (!j) { setState({ loading: false, error: t('wmsissue.jobmat.enterJobCard'), data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      setState({ loading: false, error: '', data: await loadJobCardMaterials(j) })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }
  const reload = () => load(state.data?.lookupJobCard || jobCard)
  const data = state.data
  const wo = data?.workOrder
  const site = wo?.site || (scope?.site && scope.site !== 'all' ? scope.site : '')
  const country = wo?.country || scope?.country

  return (
    <>
      <SectionCard title={t('wmsissue.jobmat.title')} sub={t('wmsissue.jobmat.sub')}>
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label={t('wmsissue.jobmat.jobCardNumber')}>
            <input className="inv-input" dir="ltr" maxLength={80} value={jobCard} onChange={(e) => setJobCard(e.target.value)} placeholder={t('wmsissue.jobmat.jobCardPlaceholder')} />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}>
              <Search size={14} aria-hidden="true" /> {state.loading ? t('wmsissue.common.loading') : t('wmsissue.jobmat.openJobCard')}
            </button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={jobCard ? () => load() : undefined} />}
        {flash && <Note tone={flash.tone}>{flash.text}</Note>}
      </SectionCard>

      {state.loading && !data && <Note>{t('wmsissue.jobmat.loadingMaterials')}</Note>}
      {data?.status === 'not_provisioned' && <NotSetUp what={t('wmsissue.jobmat.title')} />}

      {data?.status === 'ok' && (
        <>
          <SectionCard
            title={t('wmsissue.jobmat.jobCardTitle', { jobCard: data.jobCard })}
            sub={wo ? t('wmsissue.jobmat.jobCardSub', { asset: wo.asset_no || na, site: wo.site || na, status: wo.status || na }) : t('wmsissue.jobmat.noWorkOrder')}
            action={canExport && data.rows.length ? <ExportButtons data={data} /> : null}>
            <Summary summary={data.summary} />
            {data.truncated && <Note tone="warn">{t('wmsissue.jobmat.truncated', { count: data.rows.length })}</Note>}
            {!data.installationsAvailable && <Note tone="warn">{t('wmsissue.jobmat.noInstallations')}</Note>}
          </SectionCard>

          {canIssue && (
            <RequestParts data={data} site={site} country={country} onDone={(f) => { setFlash(f); reload() }} />
          )}

          <MaterialLines data={data} canIssue={canIssue} site={site} country={country} onDone={(f) => { setFlash(f); reload() }} />

          {(data.requisitions?.length > 0 || !data.requisitionLinkAvailable) && (
            <SectionCard title={t('wmsissue.jobmat.requestsTitle')} sub={t('wmsissue.jobmat.requestsSub')}>
              {!data.requisitionLinkAvailable && <Note tone="warn">{t('wmsissue.jobmat.requisitionNotLinked')}</Note>}
              {data.requisitions?.length > 0 && (
                <div className="inv-scroll">
                  <KitTable compact rows={data.requisitions} columns={alignNumeric([
                    { key: 'requisition_no', header: t('wmsissue.jobmat.colNumber'), cell: (r) => (r.requisition_no ? <span dir="ltr">{r.requisition_no}</span> : <span className="cc-na">{t('wmsissue.jobmat.pending')}</span>) },
                    { key: 'item', header: t('wmsissue.cols.item') },
                    { key: 'quantity', header: t('wmsissue.cols.qty'), numeric: true, cell: (r) => formatQty(r.quantity) },
                    { key: 'status', header: t('wmsissue.cols.status'), cell: (r) => <StatusPill value={r.status} tone="info" label={r.status} /> },
                    { key: 'created_at', header: t('wmsissue.jobmat.colRaised'), cell: (r) => fmtDateTime(r.created_at) },
                  ])} />
                </div>
              )}
              {typeof onNavigate === 'function' && (
                <div className="inv-actions"><button type="button" className="cc-btn-ghost" onClick={() => onNavigate('procurement')}><ShoppingCart size={14} aria-hidden="true" /> {t('wmsissue.jobmat.openProcurement')}</button></div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </>
  )
}

function Summary({ summary: s }) {
  const { t } = useLanguage()
  return (
    <>
      <div className="cc-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <Kpi icon={ClipboardList} tone="blue" value={s.requested} display={formatQty(s.requested)} label={t('wmsissue.jobmat.requested')} />
        <Kpi icon={Package} tone="blue" value={s.reserved} display={formatQty(s.reserved)} label={t('wmsissue.jobmat.reservedNotIssued')} />
        <Kpi icon={PackageMinus} tone="amber" value={s.issued} display={formatQty(s.issued)} label={t('wmsissue.jobmat.issued')} />
        <Kpi icon={Wrench} tone="green" value={s.installed} display={formatQty(s.installed)} label={t('wmsissue.jobmat.installed')} />
        <Kpi icon={Undo2} tone="muted" value={s.returned} display={formatQty(s.returned)} label={t('wmsissue.jobmat.returned')} />
        <Kpi icon={AlertTriangle} tone={s.unreconciled > 0 ? 'red' : 'green'} danger={s.unreconciled > 0} value={s.unreconciled} display={formatQty(s.unreconciled)} label={t('wmsissue.jobmat.unreconciled')} />
        <Kpi icon={Coins} tone="green" display={costText(s.cost, t('wmsissue.common.na'))} label={t('wmsissue.jobmat.netCost')} />
        <Kpi icon={ShoppingCart} tone="amber" value={s.openRequisitions} display={`${s.openRequisitions} (${formatQty(s.onOrderQty)})`} label={t('wmsissue.jobmat.openRequests')} />
      </div>
      {s.unvaluedQty > 0 && <Note tone="warn">{t('wmsissue.jobmat.unvaluedNote', { qty: formatQty(s.unvaluedQty) })}</Note>}
      {s.mixedCurrency && <Note>{t('wmsissue.jobmat.mixedCurrency')}</Note>}
      {s.reconciled && <Note tone="good">{t('wmsissue.jobmat.reconciled')}</Note>}
    </>
  )
}

function ExportButtons({ data }) {
  const { t } = useLanguage()
  const rows = () => data.rows.map((r) => ({ ...r, costText: costText(r.cost) }))
  const name = reportFileName('Job card materials', data.jobCard)
  return (
    <div className="inv-actions">
      <button type="button" className="cc-btn-ghost" onClick={() => exportToPdf(rows(), JOB_MATERIAL_EXPORT_COLUMNS, `Job card materials: ${data.jobCard}`, name, 'landscape')}>
        <FileDown size={14} aria-hidden="true" /> {t('wmsissue.common.pdf')}
      </button>
      <button type="button" className="cc-btn-ghost" onClick={() => exportToExcel(rows(), JOB_MATERIAL_EXPORT_COLUMNS.map((c) => c.key), JOB_MATERIAL_EXPORT_COLUMNS.map((c) => c.header), name)}>
        <FileSpreadsheet size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}
      </button>
    </div>
  )
}

/** Request parts: look in the store first, reserve what is free, requisition the rest. */
function RequestParts({ data, site, country, onDone }) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const [found, setFound] = useState({ loading: false, error: '', rows: null })
  const [pick, setPick] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const items = useMemo(() => {
    const m = new Map()
    for (const b of found.rows || []) {
      const k = b.item_code || b.description || b.id
      if (!m.has(k)) m.set(k, { key: k, itemId: b.item_id, itemCode: b.item_code, description: b.description, lines: [] })
      m.get(k).lines.push(b)
    }
    return [...m.values()]
  }, [found.rows])
  const chosen = items.find((i) => i.key === pick) || null
  const plan = chosen && qty !== '' ? planRequest({ qty, balances: chosen.lines, site }) : null

  const look = async () => {
    setErr(''); setPick('')
    if (!search.trim()) { setFound({ loading: false, error: t('wmsissue.jobmat.typeItem'), rows: null }); return }
    setFound({ loading: true, error: '', rows: null })
    try {
      setFound({ loading: false, error: '', rows: await findStockForRequest({ search, country, site }) })
    } catch (e) {
      setFound({ loading: false, error: toUserMessage(e), rows: null })
    }
  }

  const reserve = async () => {
    if (!plan?.allocations.length) return
    setBusy(true); setErr('')
    try {
      for (const a of plan.allocations) {
        const res = await reserveForJob({ stockId: a.stockId, qty: a.qty, jobCard: data.jobCard }, newIdempotencyKey())
        if (res?.status === 'refused_shortage') throw new Error(t('wmsissue.jobmat.stockChanged'))
      }
      onDone({ tone: 'good', text: t('wmsissue.jobmat.reservedDone', { qty: formatQty(plan.covered), jobCard: data.jobCard }) })
      setQty(''); setFound({ loading: false, error: '', rows: null })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy(false) }
  }

  const requisition = async () => {
    const shortage = plan ? plan.shortage : Number(qty)
    if (!(shortage > 0)) return
    setBusy(true); setErr('')
    try {
      await raiseShortageRequisition({ jobCard: data.jobCard, itemId: chosen?.itemId, itemCode: chosen?.itemCode, description: chosen?.description, qty: shortage, site, country })
      onDone({ tone: 'good', text: t('wmsissue.jobmat.requestRaised', { qty: formatQty(shortage) }) })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy(false) }
  }

  return (
    <SectionCard title={t('wmsissue.jobmat.requestParts')} sub={site ? t('wmsissue.jobmat.requestPartsSubAt', { site }) : t('wmsissue.jobmat.requestPartsSub')}>
      <form className="inv-form" onSubmit={(e) => { e.preventDefault(); look() }}>
        <Field label={t('wmsissue.jobmat.itemCodeOrDescription')}>
          <input className="inv-input" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wmsissue.jobmat.itemSearchPlaceholder')} />
        </Field>
        <div className="inv-actions">
          <button type="submit" className="cc-btn-ghost" disabled={found.loading}><Search size={14} aria-hidden="true" /> {found.loading ? t('wmsissue.jobmat.checking') : t('wmsissue.jobmat.checkStore')}</button>
        </div>
      </form>
      {found.error && <ErrorNote error={found.error} onRetry={look} />}
      {found.rows && !items.length && <Note>{site ? t('wmsissue.jobmat.noStockAt', { site }) : t('wmsissue.jobmat.noStockAnywhere')}</Note>}
      {items.length > 0 && (
        <div className="inv-form">
          <Field label={t('wmsissue.cols.item')}>
            <select className="inv-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('wmsissue.jobmat.chooseItem')}</option>
              {items.map((i) => {
                const free = i.lines.reduce((n, b) => n + Math.max(0, (Number(b.qty_on_hand) || 0) - (Number(b.qty_reserved) || 0)), 0)
                return <option key={i.key} value={i.key}>{t('wmsissue.jobmat.itemOption', { code: i.itemCode || t('wmsissue.jobmat.noCode'), description: i.description || '', free: formatQty(free) }).trim()}</option>
              })}
            </select>
          </Field>
          <Field label={t('wmsissue.jobmat.quantityNeeded')}>
            <input className="inv-input inv-num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>
      )}
      {plan && !plan.error && (
        <Note tone={plan.shortage > 0 ? 'warn' : 'good'}>
          {plan.covered > 0 ? t('wmsissue.jobmat.canReserve', { qty: formatQty(plan.covered), from: plan.allocations.map((x) => x.location || t('wmsissue.jobmat.theStore')).join(', ') }) : t('wmsissue.jobmat.nothingFree')}
          {' '}
          {plan.shortage > 0 ? t('wmsissue.jobmat.shortNeedsRequest', { qty: formatQty(plan.shortage) }) : t('wmsissue.jobmat.nothingToBuy')}
        </Note>
      )}
      {plan?.error && <p className="inv-err" role="alert">{plan.error}</p>}
      {err && <p className="inv-err" role="alert">{err}</p>}
      {plan && !plan.error && (
        <div className="inv-actions">
          {plan.covered > 0 && (
            <button type="button" className="cc-btn-primary" disabled={busy} onClick={reserve}><Package size={14} aria-hidden="true" /> {busy ? t('wmsissue.jobmat.saving') : t('wmsissue.jobmat.reserveQty', { qty: formatQty(plan.covered) })}</button>
          )}
          {plan.shortage > 0 && (
            <button type="button" className="cc-btn-ghost" disabled={busy} onClick={requisition}><ShoppingCart size={14} aria-hidden="true" /> {t('wmsissue.jobmat.requestPurchase', { qty: formatQty(plan.shortage) })}</button>
          )}
        </div>
      )}
    </SectionCard>
  )
}

/** The per-line table plus issue, install and return actions. */
function MaterialLines({ data, canIssue, site, country, onDone }) {
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const rows = data.rows
  const reservedLines = rows.flatMap((r) => r.reservations.map((res) => ({
    key: `r:${res.id}`, stockId: r.stockId, reservationId: res.id, qty: res.open,
    itemCode: r.itemCode, description: r.description, uom: r.uom, location: r.location,
  })))
  const [issuedTo, setIssuedTo] = useState('')
  const [note, setNote] = useState('')
  const [keys] = useState(() => new Map())
  const [slip, setSlip] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [action, setAction] = useState(null)

  const keyFor = (k) => { if (!keys.has(k)) keys.set(k, newIdempotencyKey()); return keys.get(k) }

  const issueAll = async () => {
    setBusy('issue'); setErr('')
    try {
      const res = await issueReservedToJob({
        jobCard: data.jobCard, workOrder: data.workOrder, site, country, lines: reservedLines,
        issuedTo, note, retrySlipId: slip?.slipId,
      }, Object.fromEntries(reservedLines.map((l) => [l.key, keyFor(l.key)])))
      if (!res.ok) {
        if (res.slipId) setSlip({ slipId: res.slipId, issueNumber: res.issueNumber })
        setErr(res.message || t('wmsissue.jobmat.notIssued'))
        return
      }
      setSlip(null); keys.clear()
      onDone({ tone: 'good', text: res.mode === 'slip'
        ? `${t('wmsissue.jobmat.issuedOnSlip', { slip: res.issueNumber || '', to: issuedTo })} ${res.already ? t('wmsissue.jobmat.alreadyPosted', { count: res.already }) : ''}`.trim()
        : t('wmsissue.jobmat.issuedLines', { count: res.posted, to: issuedTo }) })
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy('') }
  }

  const columns = alignNumeric([
    { key: 'itemCode', header: t('wmsissue.cols.item'), cell: (r) => <><strong dir="ltr">{r.itemCode || t('wmsissue.jobmat.noCode')}</strong><br /><span className="cc-card-sub">{r.description || ''}</span></> },
    { key: 'location', header: t('wmsissue.jobmat.colFrom'), cell: (r) => r.location || <span className="cc-na">{na}</span> },
    { key: 'requested', header: t('wmsissue.jobmat.requested'), numeric: true, cell: (r) => formatQty(r.requested) },
    { key: 'reserved', header: t('wmsissue.jobmat.reserved'), numeric: true, cell: (r) => formatQty(r.reserved) },
    { key: 'issued', header: t('wmsissue.jobmat.issued'), numeric: true, cell: (r) => formatQty(r.issued) },
    { key: 'installed', header: t('wmsissue.jobmat.installed'), numeric: true, cell: (r) => formatQty(r.installed) },
    { key: 'returned', header: t('wmsissue.jobmat.returned'), numeric: true, cell: (r) => formatQty(r.returned) },
    { key: 'unreconciled', header: t('wmsissue.jobmat.unreconciled'), numeric: true, cell: (r) => (r.unreconciled > 0
      ? <StatusPill value="open" tone="warn" label={formatQty(r.unreconciled)} /> : formatQty(0)) },
    { key: 'cost', header: t('wmsissue.jobmat.colNetCost'), cell: (r) => (r.cost.length ? r.cost.map((c) => formatMoney(c.amount, c.currency)).join(' | ') : (r.unvaluedQty > 0 ? <StatusPill value="unvalued" tone="warn" label={t('wmsissue.jobmat.unvalued')} /> : <span className="cc-na">{na}</span>)) },
    { key: 'act', header: t('wmsissue.jobmat.colActions'), sortable: false, cell: (r) => (
      <div className="inv-actions">
        {r.unreconciled > 0 && r.issues.some((i) => i.open > 0) && (
          <button type="button" className="cc-btn-ghost" onClick={() => setAction({ kind: 'install', row: r })}><Wrench size={14} aria-hidden="true" /> {t('wmsissue.jobmat.confirmInstalled')}</button>
        )}
        {canIssue && r.unreconciled > 0 && (
          <button type="button" className="cc-btn-ghost" onClick={() => setAction({ kind: 'return', row: r })}><Undo2 size={14} aria-hidden="true" /> {t('wmsissue.jobmat.returnUnused')}</button>
        )}
      </div>
    ) },
  ])

  return (
    <SectionCard title={t('wmsissue.jobmat.linesTitle')} sub={t('wmsissue.jobmat.linesSub')}>
      {!rows.length && <Note icon={ClipboardList}>{t('wmsissue.jobmat.nothingYet')}</Note>}
      {rows.length > 0 && <div className="inv-scroll"><KitTable compact rows={rows} columns={columns} empty={t('wmsissue.jobmat.noMaterials')} /></div>}

      {canIssue && reservedLines.length > 0 && (
        <div className="inv-form" style={{ marginTop: 12 }}>
          <Field label={t('wmsissue.jobmat.receivedBy')}>
            <input className="inv-input" maxLength={120} value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder={t('wmsissue.jobmat.receivedByPlaceholder')} />
          </Field>
          <Field label={t('wmsissue.jobmat.noteOptional')}>
            <input className="inv-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="inv-actions">
            <button type="button" className="cc-btn-primary" disabled={!!busy || !issuedTo.trim()} onClick={issueAll}>
              <PackageCheck size={14} aria-hidden="true" /> {busy === 'issue' ? t('wmsissue.jobmat.posting') : slip ? t('wmsissue.jobmat.postSlipAgain', { slip: slip.issueNumber || '' }) : t('wmsissue.jobmat.issueReserved', { count: reservedLines.length })}
            </button>
          </div>
        </div>
      )}
      {slip && <Note tone="warn">{t('wmsissue.jobmat.slipNotPosted', { slip: slip.issueNumber || '' })}</Note>}
      {err && <p className="inv-err" role="alert">{err}</p>}

      {action?.kind === 'install' && <InstallForm data={data} row={action.row} onClose={() => setAction(null)} onDone={onDone} />}
      {action?.kind === 'return' && <ReturnForm data={data} row={action.row} onClose={() => setAction(null)} onDone={onDone} />}
    </SectionCard>
  )
}

function InstallForm({ data, row, onClose, onDone }) {
  const { t } = useLanguage()
  const open = row.issues.filter((i) => i.open > 0)
  const [issueId, setIssueId] = useState(open[0]?.id || '')
  const [qty, setQty] = useState(String(Math.min(open[0]?.open || 0, row.unreconciled)))
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState(null)
  const [padOpen, setPadOpen] = useState(false)
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const issue = open.find((i) => i.id === issueId)

  const save = async () => {
    const v = validateInstall({ issue, row, qty })
    if (!v.ok) { setErr(v.error); return }
    setBusy(true); setErr('')
    const res = await confirmInstallation({ movementId: issue.id, qty: v.qty, note, signatureImage: signature }, key)
    setBusy(false)
    if (!res.ok) { setErr(res.message); return }
    onDone({ tone: 'good', text: t('wmsissue.jobmat.installedDone', { qty: formatQty(v.qty), item: row.itemCode || t('wmsissue.jobmat.part'), jobCard: data.jobCard }) })
    onClose()
  }

  return (
    <div className="cc-card" style={{ marginTop: 12, padding: 12 }}>
      <p className="cc-card-title">{t('wmsissue.jobmat.confirmInstalledTitle', { item: row.itemCode || t('wmsissue.jobmat.part') })}</p>
      <div className="inv-form">
        <Field label={t('wmsissue.jobmat.issueField')}>
          <select className="inv-input" value={issueId} onChange={(e) => setIssueId(e.target.value)}>
            {open.map((i) => <option key={i.id} value={i.id}>{`${fmtDateTime(i.postedAt)}: ${t('wmsissue.jobmat.notYetConfirmed', { qty: formatQty(i.open) })}${i.reference ? ` (${i.reference})` : ''}`}</option>)}
          </select>
        </Field>
        <Field label={t('wmsissue.jobmat.quantityFitted')}>
          <input className="inv-input inv-num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label={t('wmsissue.jobmat.noteOptional')}>
          <input className="inv-input" maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="inv-actions">
        <button type="button" className="cc-btn-ghost" onClick={() => setPadOpen(true)}>{signature ? t('wmsissue.jobmat.signAgain') : t('wmsissue.jobmat.addSignature')}</button>
      </div>
      <Note>{t('wmsissue.jobmat.selfConfirmNote')}</Note>
      {err && <p className="inv-err" role="alert">{err}</p>}
      <div className="inv-actions">
        <button type="button" className="cc-btn-primary" disabled={busy} onClick={save}><Wrench size={14} aria-hidden="true" /> {busy ? t('wmsissue.jobmat.saving') : t('wmsissue.jobmat.confirmInstalled')}</button>
        <button type="button" className="cc-btn-ghost" disabled={busy} onClick={onClose}>{t('wmsissue.common.cancel')}</button>
      </div>
      {padOpen && <SignaturePad label={t('wmsissue.jobmat.technicianSignature')} onSave={(d) => { setSignature(d); setPadOpen(false) }} onClose={() => setPadOpen(false)} />}
    </div>
  )
}

function ReturnForm({ data, row, onClose, onDone }) {
  const { t } = useLanguage()
  const [qty, setQty] = useState(String(row.unreconciled))
  const [reason, setReason] = useState(() => t('wmsissue.jobmat.defaultReturnReason'))
  const [key] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    const v = validateReturn({ row, qty, reason })
    if (!v.ok) { setErr(v.error); return }
    setBusy(true); setErr('')
    try {
      await returnUnused({ stockId: row.stockId, qty: v.qty, jobCard: data.jobCard, reason }, key)
      onDone({ tone: 'good', text: t('wmsissue.jobmat.returnedDone', { qty: formatQty(v.qty), item: row.itemCode || t('wmsissue.jobmat.part'), to: row.location || t('wmsissue.jobmat.theStore') }) })
      onClose()
    } catch (e) {
      setErr(toUserMessage(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="cc-card" style={{ marginTop: 12, padding: 12 }}>
      <p className="cc-card-title">{t('wmsissue.jobmat.returnUnusedTitle', { item: row.itemCode || t('wmsissue.jobmat.part') })}</p>
      <div className="inv-form">
        <Field label={t('wmsissue.jobmat.quantityUpTo', { qty: formatQty(row.unreconciled) })}>
          <input className="inv-input inv-num" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label={t('wmsissue.jobmat.reason')}>
          <input className="inv-input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <Note>{t('wmsissue.jobmat.returnNote')}</Note>
      {err && <p className="inv-err" role="alert">{err}</p>}
      <div className="inv-actions">
        <button type="button" className="cc-btn-primary" disabled={busy} onClick={save}><Undo2 size={14} aria-hidden="true" /> {busy ? t('wmsissue.jobmat.saving') : t('wmsissue.jobmat.returnToStore')}</button>
        <button type="button" className="cc-btn-ghost" disabled={busy} onClick={onClose}>{t('wmsissue.common.cancel')}</button>
      </div>
    </div>
  )
}
