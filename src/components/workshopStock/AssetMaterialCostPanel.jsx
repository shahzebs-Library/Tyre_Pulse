/**
 * Material cost per asset: every job card of the asset with the parts issued to
 * it, installed, returned and still unreconciled, and the net material cost per
 * currency (from the issue movements; unvalued quantity is shown as unvalued,
 * never as zero; currencies are never added together).
 * Props: { scope, can, onNavigate }.
 */
import { useState } from 'react'
import { Coins, FileSpreadsheet, Search } from 'lucide-react'
import { loadAssetMaterialCost } from '../../lib/workshopStock/service'
import { formatQty, formatTotals } from '../../lib/inventory/inventoryMoney'
import { toUserMessage } from '../../lib/inventory/errorText'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { KitTable } from '../commandCenter/kit'
import { Field, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric, fmtDate } from '../inventory/InvUi'

const costText = (cost) => (cost?.length ? formatTotals(cost) : 'N/A')

export default function AssetMaterialCostPanel({ scope, can, onNavigate }) {
  const canExport = typeof can === 'function' && can('export')
  const [asset, setAsset] = useState('')
  const [state, setState] = useState({ loading: false, error: '', data: null })

  const load = async () => {
    if (!asset.trim()) { setState({ loading: false, error: 'Enter an asset number.', data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      setState({ loading: false, error: '', data: await loadAssetMaterialCost(asset, { country: scope?.country }) })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }
  const data = state.data

  const columns = alignNumeric([
    { key: 'jobCard', header: 'Job card', cell: (r) => (typeof onNavigate === 'function'
      ? <button type="button" className="cc-btn-link" onClick={() => onNavigate('jobMaterials', { jobCard: r.jobCard })}>{r.jobCard}</button>
      : r.jobCard) },
    { key: 'openedAt', header: 'Opened', cell: (r) => fmtDate(r.openedAt) },
    { key: 'issued', header: 'Issued', numeric: true, cell: (r) => formatQty(r.issued) },
    { key: 'installed', header: 'Installed', numeric: true, cell: (r) => formatQty(r.installed) },
    { key: 'returned', header: 'Returned', numeric: true, cell: (r) => formatQty(r.returned) },
    { key: 'unreconciled', header: 'Unreconciled', numeric: true, cell: (r) => (r.unreconciled > 0 ? <StatusPill value="open" tone="warn" label={formatQty(r.unreconciled)} /> : formatQty(0)) },
    { key: 'cost', header: 'Net cost', cell: (r) => (r.cost.length ? costText(r.cost) : (r.unvaluedQty > 0 ? <StatusPill value="unvalued" tone="warn" label="Unvalued" /> : <span className="cc-na">N/A</span>)) },
  ])

  const exportExcel = () => exportToExcel(
    data.cards.map((c) => ({ ...c, openedAt: fmtDate(c.openedAt), cost: costText(c.cost) })),
    ['jobCard', 'openedAt', 'issued', 'installed', 'returned', 'unreconciled', 'cost', 'unvaluedQty'],
    ['Job card', 'Opened', 'Issued', 'Installed', 'Returned', 'Unreconciled', 'Net cost', 'Unvalued qty'],
    reportFileName('Asset material cost', data.assetNo),
  )

  return (
    <>
      <SectionCard title="Material cost per asset" sub="Parts issued to every job card of one asset, from the stock ledger.">
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label="Asset number">
            <input className="inv-input" maxLength={40} value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="e.g. TM514" />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}><Search size={14} aria-hidden="true" /> {state.loading ? 'Loading...' : 'Show cost'}</button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={asset ? load : undefined} />}
      </SectionCard>

      {data?.status === 'not_provisioned' && <NotSetUp what="Asset material cost" />}
      {data?.status === 'ok' && (
        <SectionCard
          title={`Asset ${data.assetNo}`}
          sub={`Net material cost: ${costText(data.cost)}`}
          action={canExport && data.cards.length ? <button type="button" className="cc-btn-ghost" onClick={exportExcel}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button> : null}>
          {!data.cards.length && <Note icon={Coins}>No parts were issued from the store to a job card of this asset. Older ERP issues are in Store material issue.</Note>}
          {data.unvaluedQty > 0 && <Note tone="warn">{formatQty(data.unvaluedQty)} issued unit(s) have no cost yet and are left out of the cost.</Note>}
          {data.unreconciled > 0 && <Note tone="warn">{formatQty(data.unreconciled)} issued unit(s) are not yet confirmed installed or returned.</Note>}
          {data.truncated && <Note tone="warn">Only the newest 100 job cards of this asset are read.</Note>}
          {data.cards.length > 0 && <div className="inv-scroll"><KitTable compact rows={data.cards} columns={columns} empty="No job cards" /></div>}
        </SectionCard>
      )}
    </>
  )
}
