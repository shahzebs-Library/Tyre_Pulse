/**
 * ProductionM3 (route /production-m3) - approved production (M3) ledger for the
 * Cost per M3 module. This is the denominator: (Internal + SCO + SANY) / M3.
 * Manual entry + Excel/CSV import (upload your template) + list, one country +
 * one month at a time. Approved M3 overrides raw M3 when present.
 */
import { Boxes } from 'lucide-react'
import LedgerPage from '../components/costm3/LedgerPage'
import { listProduction, createProduction, importProduction, deleteProduction } from '../lib/api/costPerM3'

export default function ProductionM3() {
  return (
    <LedgerPage
      title="Production (Approved M3)"
      subtitle="Approved production quantity per site / month - the Cost per M3 denominator"
      icon={Boxes}
      kind="production"
      amountKey="approved_m3"
      service={{ list: listProduction, create: createProduction, import: importProduction, remove: deleteProduction }}
      columns={[
        { key: 'period_date', header: 'Month' },
        { key: 'site', header: 'Site' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'm3', header: 'M3', align: 'right', kind: 'int' },
        { key: 'approved_m3', header: 'Approved M3', align: 'right', kind: 'int',
          render: (r) => (r.approved_m3 == null || r.approved_m3 === '' ? Math.round(Number(r.m3) || 0).toLocaleString() : Math.round(Number(r.approved_m3)).toLocaleString()) },
      ]}
      formFields={[
        { key: 'period_date', label: 'Month', type: 'month', required: true },
        { key: 'site', label: 'Site', type: 'text' },
        { key: 'asset_no', label: 'Asset', type: 'text' },
        { key: 'm3', label: 'M3 (produced)', type: 'number' },
        { key: 'approved_m3', label: 'Approved M3', type: 'number', required: true },
      ]}
    />
  )
}
