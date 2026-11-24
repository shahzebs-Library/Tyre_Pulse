/**
 * Hub sections for the warehouse floor and asset custody panels:
 *  - floor: put-away, picking, workshop handover
 *  - custody: tool custody, repairables, stock warranty and scrap
 *  - finance: stock vs finance reconciliation (needs view_value)
 * Each panel keeps its own loading, empty and error states.
 */
import { Tabs } from '../commandCenter/kit'
import { useLanguage } from '../../contexts/LanguageContext'
import { useHubTab } from './InvUi'
import PutawayPanel from './PutawayPanel'
import PickingPanel from './PickingPanel'
import HandoverPanel from './HandoverPanel'
import ToolCustodyPanel from './ToolCustodyPanel'
import RepairablesPanel from './RepairablesPanel'
import StockWarrantyScrapPanel from './StockWarrantyScrapPanel'
import FinanceReconcilePanel from './FinanceReconcilePanel'

const FLOOR_TABS = ['putaway', 'picking', 'handover']
const CUSTODY_TABS = ['tools', 'repairables', 'warranty']

export function FloorSection(props) {
  const { t } = useLanguage()
  const [tab, setTab] = useHubTab(props.tab, props.onTab, FLOOR_TABS, 'putaway')
  return (
    <div className="inv-hub">
      <Tabs label={t('inventory.sections.floor')} value={tab} onChange={setTab}
        tabs={FLOOR_TABS.map((k) => ({ key: k, label: t(`inventory.warehouse.floor.${k}`) }))} />
      {tab === 'putaway' && <PutawayPanel {...props} />}
      {tab === 'picking' && <PickingPanel {...props} />}
      {tab === 'handover' && <HandoverPanel {...props} />}
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
      {tab === 'repairables' && <RepairablesPanel {...props} />}
      {tab === 'warranty' && <StockWarrantyScrapPanel {...props} />}
    </div>
  )
}

export function FinanceSection(props) {
  return <div className="inv-hub"><FinanceReconcilePanel {...props} /></div>
}
