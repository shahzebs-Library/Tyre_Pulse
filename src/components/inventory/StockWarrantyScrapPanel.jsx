/**
 * Warranty and scrap for non-tyre stock.
 *
 * Warranty: a claim is raised from a stock line into the existing
 * warranty_claims table (the same records and server rules as the Warranty
 * page, /warranty), tagged with the stock line so the two stay linked. A claim
 * starts as Submitted with no credit amount; the credit is recorded on the
 * Warranty page when the supplier decides.
 *
 * Scrap: never a direct stock write. A scrap request (migration 20261124133000,
 * NOT APPLIED) is proposed, evaluated by engineering, approved by a second
 * person, posted through the ledger and then disposed with its recovery value.
 * Until the migration is applied the governed route stays a stock audit
 * adjustment. Tyres keep their own scrap marks (Scrap Management).
 * A warranty replacement is received as a normal receipt with the claim number
 * as the reference.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, FileWarning, Trash2, Search as SearchIcon } from 'lucide-react'
import { Kpi, KitTable } from '../commandCenter/kit'
import Modal from '../ui/Modal'
import { useInvQuery, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, SearchBox, Field, fmtDate, alignNumeric } from './InvUi'
import { loadStockWithLocations, listStockWarrantyClaims, listScrapMovements, raiseStockWarrantyClaim } from '../../lib/api/warehouseAssets'
import { repairableRows, claimsByStock, stockWarrantyDraft, REPAIR_STATES, STOCK_FAILURE_TYPES } from '../../lib/inventory/warehouseAssets'
import { warmFloorText } from '../../lib/inventory/floorText'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { ScrapRequestsSection, ScrapProposeModal } from '../warehouseClasses/ScrapRequests'
import { useLanguage } from '../../contexts/LanguageContext'

const CLAIM_TONE = { Submitted: 'info', 'Under Review': 'warn', Approved: 'good', Rejected: 'bad', 'Credit Issued': 'good', Closed: 'muted' }
const MATCH_LIMIT = 25
// Claim statuses and failure types are stored values; only their labels are translated.
const CLAIM_KEY = { Submitted: 'submitted', 'Under Review': 'underReview', Approved: 'approved', Rejected: 'rejected', 'Credit Issued': 'creditIssued', Closed: 'closed' }
const FAILURE_KEY = { 'Manufacturing defect': 'manufacturing', 'Failed in service before expected life': 'early', 'Wrong part supplied': 'wrongPart', 'Damaged on arrival': 'doa', Other: 'other' }
function useWarrantyText() {
  const { t } = useLanguage()
  const p = (k, v) => t(`wmsfloor.warranty.${k}`, v)
  return {
    t, p,
    NA: t('wmsfloor.common.na'),
    claimLabel: (k) => (CLAIM_KEY[k] ? t(`wmsfloor.warranty.claim.${CLAIM_KEY[k]}`) : k),
    failureLabel: (k) => (FAILURE_KEY[k] ? t(`wmsfloor.warranty.failure.${FAILURE_KEY[k]}`) : k),
    stateLabel: (k) => (REPAIR_STATES[k] ? t(`wmsfloor.repair.state.${k}`) : k),
  }
}

export default function StockWarrantyScrapPanel({ scope, can, userId, onNavigate }) {
  const { p, NA, claimLabel, failureLabel, stateLabel } = useWarrantyText()
  const stock = useInvQuery(() => loadStockWithLocations(scope), [scope.country, scope.site])
  const claims = useInvQuery(() => listStockWarrantyClaims({ country: scope.country }), [scope.country])
  const scraps = useInvQuery(() => listScrapMovements(scope), [scope.country, scope.site])
  const [term, setTerm] = useState('')
  const [claimFor, setClaimFor] = useState(null)
  const [scrapFor, setScrapFor] = useState(null)
  const [scrapReload, setScrapReload] = useState(0)
  const stockById = useMemo(() => new Map((stock.data?.valuation || []).map((r) => [r.stock_id, r])), [stock.data])
  const canScrap = can('issue') || can('count')

  const flagged = useMemo(() => repairableRows(stock.data?.valuation, stock.data?.locations), [stock.data])
  const byStock = useMemo(() => claimsByStock(claims.data?.rows), [claims.data])
  const matches = useMemo(() => {
    const s = term.trim().toUpperCase()
    if (s.length < 2) return []
    return (stock.data?.valuation || [])
      .filter((r) => String(r.item_code || '').toUpperCase().includes(s) || String(r.description || '').toUpperCase().includes(s))
      .slice(0, MATCH_LIMIT)
  }, [stock.data, term])

  const canClaim = can('receive') || can('issue')
  const claimRows = claims.data?.rows || []
  const openClaims = claimRows.filter((c) => !['Closed', 'Rejected', 'Credit Issued'].includes(c.claim_status)).length

  if (stock.error) return <ErrorNote error={stock.error} onRetry={stock.retry} />
  if (stock.data?.status === 'not_provisioned') return <NotSetUp what={p('what')} />

  const stockColumns = alignNumeric([
    { key: 'item_code', header: p('colItemCode'), cell: (r) => r.item_code || <span className="cc-na">{p('noCode')}</span> },
    { key: 'description', header: p('colDescription'), cell: (r) => r.description || NA },
    { key: 'site', header: p('colSite') },
    { key: 'condition', header: p('colCondition') },
    { key: 'state', header: p('colState'), cell: (r) => (r.state ? <StatusPill value={r.state} tone="warn" label={stateLabel(r.state)} /> : <span className="cc-na">{p('inUse')}</span>) },
    { key: 'qty_on_hand', header: p('colOnHand'), numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
    { key: 'claims', header: p('colWarranty'), cell: (r) => {
      const c = byStock.get(r.stock_id)?.[0]
      return c ? <StatusPill value={c.claim_status} tone={CLAIM_TONE[c.claim_status]} label={`${c.claim_no || p('claimWord')}: ${claimLabel(c.claim_status)}`} /> : <span className="cc-na">{p('none')}</span>
    } },
    { key: 'act', header: '', sortable: false, cell: (r) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canClaim && <button type="button" className="cc-btn-ghost" onClick={() => setClaimFor(r)}>{p('raiseClaim')}</button>}
        {canScrap && <button type="button" className="cc-btn-ghost" onClick={() => setScrapFor(r)}>{p('proposeScrap')}</button>}
      </div>
    ) },
  ])

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {claims.error && <ErrorNote error={claims.error} onRetry={claims.retry} />}
      <div className="inv-kpis">
        <Kpi icon={FileWarning} tone="t-orange" loading={stock.loading && !stock.data} value={stock.data ? flagged.length : null} label={p('kpiFlagged')} />
        <Kpi icon={ShieldCheck} tone="t-purple" loading={claims.loading && !claims.data} value={claims.data ? claimRows.length : null} label={p('kpiClaims')} />
        <Kpi icon={ShieldCheck} tone="t-blue" loading={claims.loading && !claims.data} value={claims.data ? openClaims : null} label={p('kpiOpen')} />
        <Kpi icon={Trash2} tone="t-red" loading={scraps.loading && !scraps.data} value={scraps.data ? scraps.data.rows.length : null} label={p('kpiScrap')} />
      </div>

      <SectionCard title={p('findTitle')} sub={p('findSub')}>
        <SearchBox value={term} onChange={setTerm} placeholder={p('findPlaceholder')} label={p('findLabel')} />
        {term.trim().length >= 2 && (
          <div className="inv-scroll" style={{ marginTop: 10 }}>
            <KitTable compact rows={matches} columns={stockColumns} empty={p('noMatch')} />
            {matches.length === MATCH_LIMIT && <p className="cc-card-sub">{p('firstMatches', { n: MATCH_LIMIT })}</p>}
          </div>
        )}
        {term.trim().length < 2 && <p className="cc-card-sub"><SearchIcon size={13} aria-hidden="true" /> {p('typeTwo')}</p>}
      </SectionCard>

      <SectionCard title={p('flaggedTitle')} sub={p('flaggedSub')}>
        <div className="inv-scroll">
          <KitTable compact loading={stock.loading && !stock.data} rows={flagged} columns={stockColumns} empty={p('flaggedEmpty')} />
        </div>
      </SectionCard>

      <SectionCard title={p('kpiClaims')} sub={p('claimsSub')}
        action={<Link className="cc-btn-ghost" to="/warranty">{p('openWarranty')}</Link>}>
        <div className="inv-scroll">
          <KitTable compact loading={claims.loading && !claims.data} rows={claimRows} empty={p('claimsEmpty')}
            columns={alignNumeric([
              { key: 'claim_no', header: p('colClaim'), cell: (r) => r.claim_no || NA },
              { key: 'item', header: p('colItemCode'), cell: (r) => r.custom_data?.item_code || NA },
              { key: 'qty', header: p('colQty'), numeric: true, cell: (r) => formatQty(r.custom_data?.qty) },
              { key: 'failure_type', header: p('colFailure'), cell: (r) => (r.failure_type ? failureLabel(r.failure_type) : NA) },
              { key: 'supplier', header: p('colSupplier'), cell: (r) => r.supplier || NA },
              { key: 'claim_status', header: p('colStatus'), cell: (r) => <StatusPill value={r.claim_status} tone={CLAIM_TONE[r.claim_status]} label={r.claim_status ? claimLabel(r.claim_status) : undefined} /> },
              { key: 'credit', header: p('colCredit'), numeric: true, cell: (r) => (r.credit_amount === null || r.credit_amount === undefined ? p('notDecided') : formatMoney(r.credit_amount, null)) },
              { key: 'created_at', header: p('colRaised'), cell: (r) => fmtDate(r.created_at, NA) },
            ])} />
        </div>
      </SectionCard>

      <ScrapRequestsSection scope={scope} can={can} userId={userId} stockById={stockById} reloadKey={scrapReload} />

      <SectionCard title={p('kpiScrap')} sub={p('scrapSub')}>
        <Note tone="info" title={p('otherTitle')}>
          {p('otherBody')}
          {onNavigate && <><br /><button type="button" className="cc-btn-ghost" onClick={() => onNavigate('audits')}>{p('openAudits')}</button></>}
        </Note>
        {scraps.error ? <ErrorNote error={scraps.error} onRetry={scraps.retry} /> : (
          <div className="inv-scroll">
            <KitTable compact loading={scraps.loading && !scraps.data} rows={scraps.data?.rows || []} empty={p('scrapEmpty')}
              columns={alignNumeric([
                { key: 'created_at', header: p('colDate'), cell: (r) => fmtDate(r.created_at, NA) },
                { key: 'site', header: p('colSite') },
                { key: 'description', header: p('colDescription'), cell: (r) => r.description || NA },
                { key: 'qty_change', header: p('colQty'), numeric: true, cell: (r) => formatQty(r.qty_change) },
                { key: 'reason', header: p('colReason'), cell: (r) => r.reason || NA },
                { key: 'approval_ref', header: p('colApproval'), cell: (r) => r.approval_ref || <span className="cc-na">{p('notRecorded')}</span> },
              ])} />
          </div>
        )}
      </SectionCard>

      {scrapFor && <ScrapProposeModal stock={scrapFor} onClose={() => setScrapFor(null)}
        onDone={() => { setScrapFor(null); setScrapReload((n) => n + 1) }} />}
      <ClaimModal key={claimFor?.stock_id || 'none'} stock={claimFor} onClose={() => setClaimFor(null)} onSaved={() => { setClaimFor(null); claims.retry() }} />
    </div>
  )
}

function ClaimModal({ stock, onClose, onSaved }) {
  const { t, p, failureLabel } = useWarrantyText()
  warmFloorText(t)
  const [form, setForm] = useState({ failure_type: '', qty: '', supplier: '', serial: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    const check = stockWarrantyDraft(stock, form, t)
    if (check.error) { setError(check.error); return }
    setBusy(true)
    setError(null)
    try {
      await raiseStockWarrantyClaim(stock, form)
      onSaved()
    } catch (err) {
      setError(err?.code === 'INV_BAD_CLAIM' ? err.message : toUserMessage(err, p('saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal className="cc inv-panel" open={!!stock} onClose={() => !busy && onClose()} size="md" title={p('modalTitle')}
      subtitle={stock ? p('modalSub', { code: stock.item_code || p('noCode'), description: stock.description || '', qty: formatQty(stock.qty_on_hand) }) : null}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>{p('cancel')}</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? p('saving') : p('raiseClaim')}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label={p('fWhat')} id="wc-failure">
          <select id="wc-failure" className="cc-select" value={form.failure_type} onChange={set('failure_type')}>
            <option value="">{p('choose')}</option>
            {STOCK_FAILURE_TYPES.map((f) => <option key={f} value={f}>{failureLabel(f)}</option>)}
          </select>
        </Field>
        <Field label={p('fQty')} id="wc-qty">
          <input id="wc-qty" className="cc-input" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </Field>
        <Field label={p('colSupplier')} id="wc-supplier">
          <input id="wc-supplier" className="cc-input" value={form.supplier} onChange={set('supplier')} maxLength={200} />
        </Field>
        <Field label={p('fSerial')} id="wc-serial">
          <input id="wc-serial" className="cc-input" value={form.serial} onChange={set('serial')} maxLength={100} />
        </Field>
        <Field label={p('fDetails')} id="wc-notes" full>
          <textarea id="wc-notes" className="cc-input" rows={3} value={form.notes} onChange={set('notes')} maxLength={4000} />
        </Field>
        <p className="cc-card-sub">{p('modalHint')}</p>
      </div>
    </Modal>
  )
}
