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
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { ScrapRequestsSection, ScrapProposeModal } from '../warehouseClasses/ScrapRequests'

const CLAIM_TONE = { Submitted: 'info', 'Under Review': 'warn', Approved: 'good', Rejected: 'bad', 'Credit Issued': 'good', Closed: 'muted' }
const MATCH_LIMIT = 25

export default function StockWarrantyScrapPanel({ scope, can, userId, onNavigate }) {
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
  if (stock.data?.status === 'not_provisioned') return <NotSetUp what="Stock valuation" />

  const stockColumns = alignNumeric([
    { key: 'item_code', header: 'Item code', cell: (r) => r.item_code || <span className="cc-na">No code</span> },
    { key: 'description', header: 'Description', cell: (r) => r.description || 'N/A' },
    { key: 'site', header: 'Site' },
    { key: 'condition', header: 'Condition' },
    { key: 'state', header: 'State', cell: (r) => (r.state ? <StatusPill value={r.state} tone="warn" label={REPAIR_STATES[r.state]} /> : <span className="cc-na">In use</span>) },
    { key: 'qty_on_hand', header: 'On hand', numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
    { key: 'claims', header: 'Warranty', cell: (r) => {
      const c = byStock.get(r.stock_id)?.[0]
      return c ? <StatusPill value={c.claim_status} tone={CLAIM_TONE[c.claim_status]} label={`${c.claim_no || 'Claim'}: ${c.claim_status}`} /> : <span className="cc-na">None</span>
    } },
    { key: 'act', header: '', sortable: false, cell: (r) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canClaim && <button type="button" className="cc-btn-ghost" onClick={() => setClaimFor(r)}>Raise claim</button>}
        {canScrap && <button type="button" className="cc-btn-ghost" onClick={() => setScrapFor(r)}>Propose scrap</button>}
      </div>
    ) },
  ])

  return (
    <div className="inv-hub" style={{ gap: 14 }}>
      {claims.error && <ErrorNote error={claims.error} onRetry={claims.retry} />}
      <div className="inv-kpis">
        <Kpi icon={FileWarning} tone="t-orange" loading={stock.loading && !stock.data} value={stock.data ? flagged.length : null} label="Stock lines out of normal use" />
        <Kpi icon={ShieldCheck} tone="t-purple" loading={claims.loading && !claims.data} value={claims.data ? claimRows.length : null} label="Warranty claims raised from stock" />
        <Kpi icon={ShieldCheck} tone="t-blue" loading={claims.loading && !claims.data} value={claims.data ? openClaims : null} label="Claims still open" />
        <Kpi icon={Trash2} tone="t-red" loading={scraps.loading && !scraps.data} value={scraps.data ? scraps.data.rows.length : null} label="Scrap movements posted" />
      </div>

      <SectionCard title="Find a stock line" sub="Search by item code or description, then raise a warranty claim for it.">
        <SearchBox value={term} onChange={setTerm} placeholder="Item code or description" label="Search stock" />
        {term.trim().length >= 2 && (
          <div className="inv-scroll" style={{ marginTop: 10 }}>
            <KitTable compact rows={matches} columns={stockColumns} empty="No stock line matches." />
            {matches.length === MATCH_LIMIT && <p className="cc-card-sub">Showing the first {MATCH_LIMIT} matches. Type more to narrow it.</p>}
          </div>
        )}
        {term.trim().length < 2 && <p className="cc-card-sub"><SearchIcon size={13} aria-hidden="true" /> Type at least two characters.</p>}
      </SectionCard>

      <SectionCard title="Damaged, quarantined, repairable or scrap-marked stock" sub="The usual candidates for a warranty claim or scrap.">
        <div className="inv-scroll">
          <KitTable compact loading={stock.loading && !stock.data} rows={flagged} columns={stockColumns} empty="No stock is damaged, quarantined, repairable or marked scrap." />
        </div>
      </SectionCard>

      <SectionCard title="Warranty claims raised from stock" sub="Approve, reject or record the credit on the Warranty page."
        action={<Link className="cc-btn-ghost" to="/warranty">Open Warranty</Link>}>
        <div className="inv-scroll">
          <KitTable compact loading={claims.loading && !claims.data} rows={claimRows} empty="No warranty claim has been raised from stock yet."
            columns={alignNumeric([
              { key: 'claim_no', header: 'Claim', cell: (r) => r.claim_no || 'N/A' },
              { key: 'item', header: 'Item code', cell: (r) => r.custom_data?.item_code || 'N/A' },
              { key: 'qty', header: 'Quantity', numeric: true, cell: (r) => formatQty(r.custom_data?.qty) },
              { key: 'failure_type', header: 'Failure' },
              { key: 'supplier', header: 'Supplier', cell: (r) => r.supplier || 'N/A' },
              { key: 'claim_status', header: 'Status', cell: (r) => <StatusPill value={r.claim_status} tone={CLAIM_TONE[r.claim_status]} /> },
              { key: 'credit', header: 'Credit', numeric: true, cell: (r) => (r.credit_amount === null || r.credit_amount === undefined ? 'Not decided' : formatMoney(r.credit_amount, null)) },
              { key: 'created_at', header: 'Raised', cell: (r) => fmtDate(r.created_at) },
            ])} />
        </div>
      </SectionCard>

      <ScrapRequestsSection scope={scope} can={can} userId={userId} stockById={stockById} reloadKey={scrapReload} />

      <SectionCard title="Scrap movements posted" sub="Scrap reduces stock, so it always needs a reason and a second person's approval.">
        <Note tone="info" title="Other routes">
          A count difference found in a stock audit becomes an adjustment that a second person approves. Tyres are scrapped in
          Scrap Management. A warranty replacement is received as a normal receipt with the claim number as its reference.
          {onNavigate && <><br /><button type="button" className="cc-btn-ghost" onClick={() => onNavigate('audits')}>Open stock audits</button></>}
        </Note>
        {scraps.error ? <ErrorNote error={scraps.error} onRetry={scraps.retry} /> : (
          <div className="inv-scroll">
            <KitTable compact loading={scraps.loading && !scraps.data} rows={scraps.data?.rows || []} empty="No scrap movement has been posted."
              columns={alignNumeric([
                { key: 'created_at', header: 'Date', cell: (r) => fmtDate(r.created_at) },
                { key: 'site', header: 'Site' },
                { key: 'description', header: 'Description', cell: (r) => r.description || 'N/A' },
                { key: 'qty_change', header: 'Quantity', numeric: true, cell: (r) => formatQty(r.qty_change) },
                { key: 'reason', header: 'Reason', cell: (r) => r.reason || 'N/A' },
                { key: 'approval_ref', header: 'Approval', cell: (r) => r.approval_ref || <span className="cc-na">Not recorded</span> },
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
  const [form, setForm] = useState({ failure_type: '', qty: '', supplier: '', serial: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    const check = stockWarrantyDraft(stock, form)
    if (check.error) { setError(check.error); return }
    setBusy(true)
    setError(null)
    try {
      await raiseStockWarrantyClaim(stock, form)
      onSaved()
    } catch (err) {
      setError(err?.code === 'INV_BAD_CLAIM' ? err.message : toUserMessage(err, 'The claim could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal className="cc inv-panel" open={!!stock} onClose={() => !busy && onClose()} size="md" title="Raise a warranty claim"
      subtitle={stock ? `${stock.item_code || 'No code'}: ${stock.description || ''} (${formatQty(stock.qty_on_hand)} on hand)` : null}
      footer={(
        <div className="inv-actions">
          <button type="button" className="cc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cc-btn" onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Raise claim'}</button>
        </div>
      )}>
      <div className="inv-form">
        {error && <p className="inv-err" role="alert">{error}</p>}
        <Field label="What went wrong" id="wc-failure">
          <select id="wc-failure" className="cc-select" value={form.failure_type} onChange={set('failure_type')}>
            <option value="">Choose</option>
            {STOCK_FAILURE_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Quantity covered" id="wc-qty">
          <input id="wc-qty" className="cc-input" type="number" min="0" step="any" value={form.qty} onChange={set('qty')} />
        </Field>
        <Field label="Supplier" id="wc-supplier">
          <input id="wc-supplier" className="cc-input" value={form.supplier} onChange={set('supplier')} maxLength={200} />
        </Field>
        <Field label="Serial or batch (if any)" id="wc-serial">
          <input id="wc-serial" className="cc-input" value={form.serial} onChange={set('serial')} maxLength={100} />
        </Field>
        <Field label="Details" id="wc-notes" full>
          <textarea id="wc-notes" className="cc-input" rows={3} value={form.notes} onChange={set('notes')} maxLength={4000} />
        </Field>
        <p className="cc-card-sub">The claim starts as Submitted with no credit amount. Record the supplier&apos;s decision and any credit on the Warranty page.</p>
      </div>
    </Modal>
  )
}
