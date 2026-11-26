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
import { useLanguage } from '../../contexts/LanguageContext'
import { Field, ErrorNote, Note, NotSetUp, SectionCard, StatusPill, alignNumeric, fmtDate } from '../inventory/InvUi'

const costText = (cost, na = 'N/A') => (cost?.length ? formatTotals(cost) : na)

export default function AssetMaterialCostPanel({ scope, can, onNavigate }) {
  const { t } = useLanguage()
  const na = t('wmsissue.common.na')
  const canExport = typeof can === 'function' && can('export')
  const [asset, setAsset] = useState('')
  const [state, setState] = useState({ loading: false, error: '', data: null })

  const load = async () => {
    if (!asset.trim()) { setState({ loading: false, error: t('wmsissue.assetcost.enterAsset'), data: null }); return }
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      setState({ loading: false, error: '', data: await loadAssetMaterialCost(asset, { country: scope?.country }) })
    } catch (e) {
      setState({ loading: false, error: toUserMessage(e), data: null })
    }
  }
  const data = state.data

  const columns = alignNumeric([
    { key: 'jobCard', header: t('wmsissue.cols.jobCard'), cell: (r) => (typeof onNavigate === 'function'
      ? <button type="button" className="cc-btn-link" dir="ltr" onClick={() => onNavigate('jobMaterials', { jobCard: r.jobCard })}>{r.jobCard}</button>
      : <span dir="ltr">{r.jobCard}</span>) },
    { key: 'openedAt', header: t('wmsissue.assetcost.opened'), cell: (r) => fmtDate(r.openedAt) },
    { key: 'issued', header: t('wmsissue.jobmat.issued'), numeric: true, cell: (r) => formatQty(r.issued) },
    { key: 'installed', header: t('wmsissue.jobmat.installed'), numeric: true, cell: (r) => formatQty(r.installed) },
    { key: 'returned', header: t('wmsissue.jobmat.returned'), numeric: true, cell: (r) => formatQty(r.returned) },
    { key: 'unreconciled', header: t('wmsissue.jobmat.unreconciled'), numeric: true, cell: (r) => (r.unreconciled > 0 ? <StatusPill value="open" tone="warn" label={formatQty(r.unreconciled)} /> : formatQty(0)) },
    { key: 'cost', header: t('wmsissue.jobmat.colNetCost'), cell: (r) => (r.cost.length ? costText(r.cost, na) : (r.unvaluedQty > 0 ? <StatusPill value="unvalued" tone="warn" label={t('wmsissue.jobmat.unvalued')} /> : <span className="cc-na">{na}</span>)) },
  ])

  const exportExcel = () => exportToExcel(
    data.cards.map((c) => ({ ...c, openedAt: fmtDate(c.openedAt), cost: costText(c.cost) })),
    ['jobCard', 'openedAt', 'issued', 'installed', 'returned', 'unreconciled', 'cost', 'unvaluedQty'],
    ['Job card', 'Opened', 'Issued', 'Installed', 'Returned', 'Unreconciled', 'Net cost', 'Unvalued qty'],
    reportFileName('Asset material cost', data.assetNo),
  )

  return (
    <>
      <SectionCard title={t('wmsissue.assetcost.title')} sub={t('wmsissue.assetcost.sub')}>
        <form className="inv-form" onSubmit={(e) => { e.preventDefault(); load() }}>
          <Field label={t('wmsissue.assetcost.assetNumber')}>
            <input className="inv-input" dir="ltr" maxLength={40} value={asset} onChange={(e) => setAsset(e.target.value)} placeholder={t('wmsissue.assetcost.assetPlaceholder')} />
          </Field>
          <div className="inv-actions">
            <button type="submit" className="cc-btn-primary" disabled={state.loading}><Search size={14} aria-hidden="true" /> {state.loading ? t('wmsissue.common.loading') : t('wmsissue.assetcost.showCost')}</button>
          </div>
        </form>
        {state.error && <ErrorNote error={state.error} onRetry={asset ? load : undefined} />}
      </SectionCard>

      {data?.status === 'not_provisioned' && <NotSetUp what={t('wmsissue.assetcost.notSetUp')} />}
      {data?.status === 'ok' && (
        <SectionCard
          title={t('wmsissue.assetcost.assetTitle', { asset: data.assetNo })}
          sub={t('wmsissue.assetcost.netCost', { cost: costText(data.cost, na) })}
          action={canExport && data.cards.length ? <button type="button" className="cc-btn-ghost" onClick={exportExcel}><FileSpreadsheet size={14} aria-hidden="true" /> {t('wmsissue.common.excel')}</button> : null}>
          {!data.cards.length && <Note icon={Coins}>{t('wmsissue.assetcost.noParts')}</Note>}
          {data.unvaluedQty > 0 && <Note tone="warn">{t('wmsissue.assetcost.unvalued', { qty: formatQty(data.unvaluedQty) })}</Note>}
          {data.unreconciled > 0 && <Note tone="warn">{t('wmsissue.assetcost.unreconciled', { qty: formatQty(data.unreconciled) })}</Note>}
          {data.truncated && <Note tone="warn">{t('wmsissue.assetcost.truncated')}</Note>}
          {data.cards.length > 0 && <div className="inv-scroll"><KitTable compact rows={data.cards} columns={columns} empty={t('wmsissue.assetcost.noJobCards')} /></div>}
        </SectionCard>
      )}
    </>
  )
}
