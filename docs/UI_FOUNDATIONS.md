# UI Foundations — DataTable + Form Kit (roadmap items 1–3)

New shared foundations. **Rule: new pages MUST use these; existing pages
convert opportunistically** (one page per PR, never as a drive-by).

## DataTable (`src/components/ui/DataTable.jsx`)

Enterprise table on TanStack Table v8: debounced global search, per-column
filters (text / select facets via `meta.options`), multi-sort (shift-click),
pagination with page-size selector, column visibility menu, sticky header,
optional row selection with bulk-action slot, CSV export of the filtered
rows, density toggle, loading skeletons and an empty-state slot.

```jsx
import DataTable from '../components/ui/DataTable'

const columns = [
  { accessorKey: 'asset_no', header: 'Asset', meta: { label: 'Asset No' } },
  { accessorKey: 'brand',    header: 'Brand', meta: { label: 'Brand', options: brands } },
  { accessorKey: 'cost_per_tyre', header: 'Cost', meta: { label: 'Cost / Tyre' } },
]

<DataTable
  data={rows}
  columns={columns}
  selectable
  exportName="tyres"
  loading={isLoading}
  emptyMessage="No tyres match the current filters."
  onSelectionChange={setSelected}
/>
```

Client-side row model only for now — a server-side pagination adapter is the
natural next step for >10k-row modules.

**Conversion order (from the roadmap):** Fleet → Tyres → Inventory →
Vendors → Inspections → Accidents → Job Cards → Reports → Users.

## Form kit (`src/components/ui/form/`) + schemas (`src/lib/validation/`)

react-hook-form + zod. Schemas encode the roadmap's data-quality rules
(invalid pressure/tread bounds, serial pattern, VIN ISO-3779, no future
issue dates, email/phone shapes) so invalid data never reaches Supabase.

```jsx
import { Form, TextField, NumberField, DateField, SelectField } from '../components/ui/form'
import { tyreRecordSchema } from '../lib/validation'

<Form schema={tyreRecordSchema} defaultValues={record} onSubmit={save}
      submitLabel="Save tyre" cancelLabel="Cancel" onCancel={close}>
  <TextField  name="asset_no"      label="Asset No" required />
  <TextField  name="serial_no"     label="Serial No" hint="3-32 chars, letters/digits/dashes" />
  <NumberField name="cost_per_tyre" label="Cost / Tyre" />
  <DateField  name="issue_date"    label="Issue Date" />
</Form>
```

Server-side validation stays authoritative (DB constraints + RLS); zod is the
fast client gate. `validate(schema, values)` is available for non-RHF call
sites (import flows, API modules).

Available schemas: `tyreRecordSchema`, `inspectionSchema`, `vehicleSchema`,
`vendorSchema`, `purchaseOrderSchema`.

## Charts (`src/components/charts/`)

`EChart` lazy-loads Apache ECharts (separate chunk — not in the entry bundle)
with theme-aware colors and ResizeObserver sizing. Executive components:
`TrendChart`, `HeatmapChart`, `GaugeChart`, `ParetoChart` — thin option
builders over `EChart`, each with a pure `build*Option()` export for testing.
Use these for executive/TV analytics; Chart.js remains fine for simple
operational dashboards.
