/**
 * Hub sections for the warehouse floor and asset custody panels:
 *  - floor: put-away, picking, workshop handover
 *  - custody: tool custody, repairables, stock warranty and scrap
 *  - finance: stock vs finance reconciliation (needs view_value)
 * Each panel keeps its own loading, empty and error states.
 */
import { useState } from 'react'
import { Tabs } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { useHubTab } from './InvUi'
import PutawayPanel from './PutawayPanel'
import PickingPanel from './PickingPanel'
import HandoverPanel from './HandoverPanel'
import ToolCustodyPanel from './ToolCustodyPanel'
import RepairablesPanel from './RepairablesPanel'
import StockWarrantyScrapPanel from './StockWarrantyScrapPanel'
import FinanceReconcilePanel from './FinanceReconcilePanel'
import JobCardMaterialsPanel from '../workshopStock/JobCardMaterialsPanel'
import AssetMaterialCostPanel from '../workshopStock/AssetMaterialCostPanel'
import LubricantsPanel from '../warehouseClasses/LubricantsPanel'
import PurchaseApprovalLimitsPanel from '../procurement/PurchaseApprovalLimitsPanel'
import { RfqPanel, BackorderPanel, SupplierReturnsPanel, ThreeWayMatchPanel, SupplierApprovalPanel, SupplierPerformancePanel, EmergencyPurchasesPanel } from '../procurement/ProcurementDepthPanels'
import MaterialLinkHealthCard from '../oem/MaterialLinkHealthCard'
import MaterialLinkQueuePanel from '../oem/MaterialLinkQueuePanel'
import OemApprovedPartsPanel from '../oem/OemApprovedPartsPanel'

const FLOOR_TABS = ['jobmaterials', 'putaway', 'picking', 'handover', 'assetcost']
const CUSTODY_TABS = ['tools', 'lubricants', 'repairables', 'warranty']

export function FloorSection(props) {
  const { t } = useLanguage()
  const [tab, setTab] = useHubTab(props.tab, props.onTab, FLOOR_TABS, 'jobmaterials')
  const [jobCard, setJobCard] = useState('')
  // The asset cost panel opens a job card's materials; every other key is a hub section.
  const navigate = (key, opts) => {
    if (key === 'jobMaterials') { setJobCard(opts?.jobCard || ''); setTab('jobmaterials'); return }
    props.onNavigate?.(key)
  }
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.floor')} value={tab} onChange={setTab}
        tabs={FLOOR_TABS.map((k) => ({ key: k, label: t(`inventory.warehouse.floor.${k}`) }))} />
      {tab === 'jobmaterials' && <JobCardMaterialsPanel key={jobCard} {...props} onNavigate={navigate} initialJobCard={jobCard} />}
      {tab === 'putaway' && <PutawayPanel {...props} />}
      {tab === 'picking' && <PickingPanel {...props} />}
      {tab === 'handover' && <HandoverPanel {...props} />}
      {tab === 'assetcost' && <AssetMaterialCostPanel {...props} onNavigate={navigate} />}
    </div>
  )
}

export function CustodySection(props) {
  const { t } = useLanguage()
  const [tab, setTab] = useHubTab(props.tab, props.onTab, CUSTODY_TABS, 'tools')
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.custody')} value={tab} onChange={setTab}
        tabs={CUSTODY_TABS.map((k) => ({ key: k, label: t(`inventory.warehouse.custody.${k}`) }))} />
      {tab === 'tools' && <ToolCustodyPanel {...props} />}
      {tab === 'lubricants' && <LubricantsPanel {...props} />}
      {tab === 'repairables' && <RepairablesPanel {...props} />}
      {tab === 'warranty' && <StockWarrantyScrapPanel {...props} />}
    </div>
  )
}

export function FinanceSection(props) {
  return <div className="inv-hub"><FinanceReconcilePanel {...props} /></div>
}

const PURCHASING_TABS = ['quotations', 'backorders', 'returns', 'approved', 'performance', 'emergency', 'invoicematch', 'limits']

export function PurchasingSection(props) {
  const { t } = useLanguage()
  const canMatch = props.can?.('procure') || props.can?.('financial_post')
  // Limits are set by administrators only; the database refuses anyone else anyway.
  const { profile, isSuperAdmin } = useAuth() || {}
  const isAdmin = !!isSuperAdmin || profile?.role === 'Admin'
  const tabs = PURCHASING_TABS.filter((k) => (k !== 'invoicematch' || canMatch) && (k !== 'limits' || isAdmin))
  const [tab, setTab] = useHubTab(props.tab, props.onTab, tabs, 'quotations')
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.purchasing')} value={tab} onChange={setTab}
        tabs={tabs.map((k) => ({ key: k, label: t(`inventory.warehouse.purchasing.${k}`) }))} />
      {tab === 'quotations' && <RfqPanel {...props} />}
      {tab === 'backorders' && <BackorderPanel {...props} />}
      {tab === 'returns' && <SupplierReturnsPanel {...props} />}
      {tab === 'approved' && <SupplierApprovalPanel {...props} />}
      {tab === 'performance' && <SupplierPerformancePanel {...props} />}
      {tab === 'emergency' && <EmergencyPurchasesPanel {...props} />}
      {tab === 'invoicematch' && canMatch && <ThreeWayMatchPanel {...props} />}
      {tab === 'limits' && isAdmin && <PurchaseApprovalLimitsPanel {...props} />}
    </div>
  )
}

const MATCHING_TABS = ['links', 'oemparts']

export function MatchingSection(props) {
  const { t } = useLanguage()
  const [tab, setTab] = useHubTab(props.tab, props.onTab, MATCHING_TABS, 'links')
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.matching')} value={tab} onChange={setTab}
        tabs={MATCHING_TABS.map((k) => ({ key: k, label: t(`inventory.warehouse.matching.${k}`) }))} />
      {tab === 'links' && <><MaterialLinkHealthCard /><MaterialLinkQueuePanel {...props} /></>}
      {tab === 'oemparts' && <OemApprovedPartsPanel {...props} />}
    </div>
  )
}
