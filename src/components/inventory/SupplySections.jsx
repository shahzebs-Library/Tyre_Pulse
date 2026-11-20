/**
 * Supply side of the hub: Procurement, Receiving & issue, Supplier stock.
 *
 * The existing screens (Procurement, Requisitions, Parts Requests, Stock
 * Replenishment, Goods Receipt, Store Material Issue, Suppliers) are LINKED,
 * not rebuilt. What is added here is the line-level view the contract
 * introduces (PO lines, GRN lines, supplier agreements, consignment stock).
 * Financial postings stay in the ERP: nothing here creates a liability.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, ClipboardList, Wrench, TrendingUp, PackageCheck, PackageMinus, Truck, ExternalLink } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { listPoLines, listGrnLines, listSupplierAgreements, listBalances } from '../../lib/api/inventory'
import { formatMoney, formatQty } from '../../lib/inventory/inventoryMoney'
import { useInvQuery, PagedTable, SearchBox, Note, StatusPill, SectionCard, fmtDate } from './InvUi'
import { ReceiveGoodsPanel, ReserveIssuePanel } from './StockFlows'

function LinkCards({ links }) {
  const { t } = useLanguage()
  const { profile, isSuperAdmin } = useAuth()
  const role = profile?.role
  const shown = links.filter((l) => !l.roles || isSuperAdmin || l.roles.includes(role))
  if (!shown.length) return null
  return (
    <div className="inv-links">
      {shown.map(({ to, icon: Icon, labelKey, subKey }) => (
        <Link key={to} to={to} className="inv-linkcard">
          <Icon size={18} aria-hidden="true" style={{ color: 'var(--cc-green)', flex: 'none' }} />
          <span style={{ flex: 1 }}>{t(labelKey)}<small>{t(subKey)}</small></span>
          <ExternalLink size={14} aria-hidden="true" style={{ color: 'var(--cc-ink-3)' }} />
        </Link>
      ))}
    </div>
  )
}

const AMD = ['Admin', 'Manager', 'Director']

function usePaged(loader, deps) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const q = useInvQuery(() => loader(page, pageSize), [...deps, page, pageSize])
  return { q, page, pageSize, setPage, setPageSize: (s) => { setPageSize(s); setPage(0) }, reset: () => setPage(0) }
}

export function ProcurementSection({ can }) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const p = usePaged((page, pageSize) => listPoLines({ page, pageSize, search }), [search])
  const showValue = can('view_value')
  return (
    <div className="inv-hub">
      <LinkCards links={[
        { to: '/stock-replenishment', icon: TrendingUp, labelKey: 'inventory.links.replenishment', subKey: 'inventory.links.replenishmentSub', roles: AMD },
        { to: '/requisitions', icon: ClipboardList, labelKey: 'inventory.links.requisitions', subKey: 'inventory.links.requisitionsSub', roles: AMD },
        { to: '/parts-requests', icon: Wrench, labelKey: 'inventory.links.partsRequests', subKey: 'inventory.links.partsRequestsSub', roles: AMD },
        { to: '/procurement', icon: ShoppingCart, labelKey: 'inventory.links.procurement', subKey: 'inventory.links.procurementSub' },
      ]} />
      <Note>{t('inventory.supply.erpRule')}</Note>
      <SectionCard title={t('inventory.supply.poLines')} sub={t('inventory.supply.poLinesSub')}>
        <div className="cc-filters" style={{ marginBottom: 10 }}>
          <SearchBox value={search} onChange={(v) => { setSearch(v); p.reset() }} placeholder={t('inventory.supply.poSearch')} />
        </div>
        <PagedTable query={p.q} page={p.page} pageSize={p.pageSize} onPage={p.setPage} onPageSize={p.setPageSize}
          empty={t('inventory.supply.poEmpty')} what={t('inventory.objects.purchase_order_lines')} noun={t('inventory.supply.linesNoun')}
          columns={[
            { key: 'po_number', header: t('inventory.supply.po'), cell: (r) => <span className="inv-mono">{r.po_number || 'N/A'}</span> },
            { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || <span className="cc-na">N/A</span> },
            { key: 'description', header: t('inventory.common.description'), cell: (r) => r.description || <span className="cc-na">N/A</span> },
            { key: 'ordered_qty', header: t('inventory.supply.ordered'), numeric: true, cell: (r) => formatQty(r.ordered_qty) },
            { key: 'received_qty', header: t('inventory.supply.received'), numeric: true, cell: (r) => formatQty(r.received_qty) },
            { key: 'outstanding', header: t('inventory.supply.outstanding'), numeric: true, cell: (r) => (r.ordered_qty == null || r.received_qty == null ? <span className="cc-na">N/A</span> : formatQty(Math.max(0, Number(r.ordered_qty) - Number(r.received_qty)))) },
            ...(showValue ? [{ key: 'unit_price', header: t('inventory.supply.unitPrice'), numeric: true, cell: (r) => formatMoney(r.unit_price, r.currency) }] : []),
            { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone="info" /> },
          ]} />
      </SectionCard>
    </div>
  )
}

export function ReceivingSection({ scope, can }) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const p = usePaged((page, pageSize) => listGrnLines({ page, pageSize, search }), [search])
  const showValue = can('view_value')
  return (
    <div className="inv-hub">
      <LinkCards links={[
        { to: '/goods-receipt', icon: PackageCheck, labelKey: 'inventory.links.goodsReceipt', subKey: 'inventory.links.goodsReceiptSub', roles: AMD },
        { to: '/store-material-issue', icon: PackageMinus, labelKey: 'inventory.links.materialIssue', subKey: 'inventory.links.materialIssueSub', roles: AMD },
      ]} />
      <Note>{t('inventory.supply.receiveRule')}</Note>
      <ReceiveGoodsPanel scope={scope} can={can} />
      <ReserveIssuePanel scope={scope} can={can} />
      <SectionCard title={t('inventory.supply.grnLines')} sub={t('inventory.supply.grnLinesSub')}>
        <div className="cc-filters" style={{ marginBottom: 10 }}>
          <SearchBox value={search} onChange={(v) => { setSearch(v); p.reset() }} placeholder={t('inventory.supply.grnSearch')} />
        </div>
        <PagedTable query={p.q} page={p.page} pageSize={p.pageSize} onPage={p.setPage} onPageSize={p.setPageSize}
          empty={t('inventory.supply.grnEmpty')} what={t('inventory.objects.goods_receipt_lines')} noun={t('inventory.supply.linesNoun')}
          columns={[
            { key: 'grn_number', header: t('inventory.supply.grn'), cell: (r) => <span className="inv-mono">{r.grn_number || 'N/A'}</span> },
            { key: 'po_number', header: t('inventory.supply.po'), cell: (r) => r.po_number || <span className="cc-na">{t('inventory.supply.noPo')}</span> },
            { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || <span className="cc-na">N/A</span> },
            { key: 'received_qty', header: t('inventory.supply.received'), numeric: true, cell: (r) => formatQty(r.received_qty) },
            { key: 'accepted_qty', header: t('inventory.supply.accepted'), numeric: true, cell: (r) => formatQty(r.accepted_qty) },
            { key: 'rejected_qty', header: t('inventory.supply.rejected'), numeric: true, cell: (r) => formatQty(r.rejected_qty) },
            ...(showValue ? [{ key: 'unit_cost', header: t('inventory.opening.unitCost'), numeric: true, cell: (r) => formatMoney(r.unit_cost, r.currency) }] : []),
            { key: 'created_at', header: t('inventory.common.created'), cell: (r) => fmtDate(r.created_at) },
          ]} />
      </SectionCard>
    </div>
  )
}

export function SupplierSection({ scope, can }) {
  const { t } = useLanguage()
  const [type, setType] = useState('all')
  const a = usePaged((page, pageSize) => listSupplierAgreements({ page, pageSize, type }), [type])
  const c = usePaged((page, pageSize) => listBalances({ ...scope, page, pageSize, ownership: 'consignment' }), [scope.country, scope.site])
  const showValue = can('view_value')
  return (
    <div className="inv-hub">
      <LinkCards links={[{ to: '/suppliers', icon: Truck, labelKey: 'inventory.links.suppliers', subKey: 'inventory.links.suppliersSub' }]} />
      <Note>{t('inventory.supply.consignmentRule')}</Note>
      <SectionCard title={t('inventory.supply.agreements')} sub={t('inventory.supply.agreementsSub')}>
        <label className="cc-field" style={{ maxWidth: 220, marginBottom: 10 }}>
          <span>{t('inventory.supply.agreementType')}</span>
          <select className="cc-select" value={type} onChange={(e) => { setType(e.target.value); a.reset() }}>
            {['all', 'consignment', 'vmi', 'framework'].map((x) => <option key={x} value={x}>{t(`inventory.supply.types.${x}`)}</option>)}
          </select>
        </label>
        <PagedTable query={a.q} page={a.page} pageSize={a.pageSize} onPage={a.setPage} onPageSize={a.setPageSize}
          empty={t('inventory.supply.agreementsEmpty')} what={t('inventory.objects.supplier_agreements')} noun={t('inventory.supply.agreementsNoun')}
          columns={[
            { key: 'supplier_name', header: t('inventory.supply.supplier'), cell: (r) => r.supplier_name || <span className="cc-na">N/A</span> },
            { key: 'agreement_type', header: t('inventory.supply.agreementType'), cell: (r) => (r.agreement_type ? t(`inventory.supply.types.${r.agreement_type}`) : 'N/A') },
            { key: 'lead_time_days', header: t('inventory.supply.leadTime'), numeric: true, cell: (r) => formatQty(r.lead_time_days) },
            { key: 'min_qty', header: t('inventory.supply.minMax'), cell: (r) => `${formatQty(r.min_qty)} / ${formatQty(r.max_qty)}` },
            { key: 'expires_at', header: t('inventory.supply.expires'), cell: (r) => fmtDate(r.expires_at) },
            { key: 'status', header: t('inventory.common.status'), cell: (r) => <StatusPill value={r.status} tone="info" /> },
          ]} />
      </SectionCard>
      <SectionCard title={t('inventory.supply.consignmentStock')} sub={t('inventory.supply.consignmentStockSub')}>
        <PagedTable query={c.q} page={c.page} pageSize={c.pageSize} onPage={c.setPage} onPageSize={c.setPageSize}
          empty={t('inventory.supply.consignmentEmpty')} what={t('inventory.objects.stock_records')} noun={t('inventory.supply.linesNoun')}
          columns={[
            { key: 'item_code', header: t('inventory.common.item'), cell: (r) => r.item_code || r.description || <span className="cc-na">N/A</span> },
            { key: 'location_code', header: t('inventory.common.location'), cell: (r) => r.location_code || r.site || <span className="cc-na">N/A</span> },
            { key: 'qty_on_hand', header: t('inventory.register.onHand'), numeric: true, cell: (r) => formatQty(r.qty_on_hand) },
            ...(showValue ? [{ key: 'avg_unit_cost', header: t('inventory.supply.agreedPrice'), numeric: true, cell: (r) => formatMoney(r.avg_unit_cost, r.currency) }] : []),
          ]} />
      </SectionCard>
    </div>
  )
}
