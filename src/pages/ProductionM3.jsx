/**
 * ProductionM3 (route /production-m3) - concrete production (approved M3) for the
 * Cost per M3 module, plus a rejections report.
 *
 * The batching export is imported here: Station = site, Approved/Signed Qty is the
 * counted quantity (the cost/m3 denominator), and Rejection Type / Reason / Remarks
 * feed the rejections report (how many m3 were sent but NOT approved, by site and by
 * reason). Manual entry + Excel/CSV import + list, one country + one month at a time.
 */
import LedgerPage from '../components/costm3/LedgerPage'
import ProductionRejectionsPanel from '../components/costm3/ProductionRejectionsPanel'
import { listProduction, createProduction, importProduction, deleteProduction } from '../lib/api/costPerM3'

const intCell = (v) => (v == null || v === '' ? 'N/A' : Math.round(Number(v)).toLocaleString())

export default function ProductionM3() {
  return (
    <div>
      <LedgerPage
        title="Production (Concrete)"
        subtitle="Batching loads - approved M3 is the Cost per M3 denominator; rejections tracked below"
        kind="production"
        amountKey="approved_m3"
        service={{ list: listProduction, create: createProduction, import: importProduction, remove: deleteProduction }}
        columns={[
          { key: 'period_date', header: 'Date' },
          { key: 'site', header: 'Station' },
          { key: 'asset_no', header: 'Truck' },
          { key: 'pump_no', header: 'Pump' },
          { key: 'dn_number', header: 'DN' },
          { key: 'mix_code', header: 'Mix' },
          { key: 'm3', header: 'Supplied', align: 'right', kind: 'int' },
          { key: 'approved_m3', header: 'Approved', align: 'right', kind: 'int',
            render: (r) => intCell(r.approved_m3 ?? r.m3) },
          { key: 'rejected', header: 'Rejected', render: (r) => (r.rejected ? 'Yes' : 'No') },
          { key: 'reason', header: 'Reason' },
        ]}
        formFields={[
          { key: 'period_date', label: 'Month', type: 'month', required: true },
          { key: 'site', label: 'Station / Site', type: 'text' },
          { key: 'asset_no', label: 'Truck', type: 'text' },
          { key: 'm3', label: 'Supplied M3', type: 'number' },
          { key: 'approved_m3', label: 'Approved M3', type: 'number', required: true },
          { key: 'reason', label: 'Rejection reason (if any)', type: 'text' },
        ]}
      />
      <div className="p-4 md:p-6 max-w-[1300px] mx-auto pt-0">
        <ProductionRejectionsPanel />
      </div>
    </div>
  )
}
