// ─────────────────────────────────────────────────────────────────────────────
// kpi/registry.js - Central KPI registry (Phase 5)
// Pure module. No network, no Supabase, no React. Declarative KPI metadata only.
// `compute` references an EXISTING exported fn in kpiEngine.js / analyticsEngine.js
// by name - this file never re-implements KPI math. Where no pure compute fn
// exists yet, `compute` is null (flagged in notes) rather than fabricated.
// ─────────────────────────────────────────────────────────────────────────────

const HIGHER = 'higher_is_better'
const LOWER = 'lower_is_better'

export const KPI_REGISTRY = Object.freeze([
  {
    key: 'tyre_cost_per_km', name: 'Tyre Cost per Km (CPK)',
    definition: 'Fleet average cost per kilometre for removed tyres with valid cost + km run.',
    formula: 'sum(cost_per_tyre) / sum(km_at_removal - km_at_fitment) over valid records; fleet avg = mean(per-record CPK)',
    unit: 'currency_per_km', sourceTables: ['tyre_records'],
    filters: { country: 'scoped', validity: 'km_at_removal > km_at_fitment AND cost_per_tyre > 0' },
    target: null, owner: 'Fleet Engineering', direction: LOWER,
    compute: 'computeCpkFleet', computeModule: 'kpiEngine',
  },
  {
    key: 'cost_per_vehicle', name: 'Cost per Vehicle',
    definition: 'CPK and total tyre cost grouped by asset_no (vehicle), worst-first.',
    formula: 'per asset_no: mean(CPK), sum(cost_per_tyre)',
    unit: 'currency', sourceTables: ['tyre_records'],
    filters: { country: 'scoped', groupBy: 'asset_no' },
    target: null, owner: 'Fleet Engineering', direction: LOWER,
    compute: 'computeCpkByAsset', computeModule: 'kpiEngine',
  },
  {
    key: 'cost_by_site', name: 'Cost by Site',
    definition: 'Total tyre spend (cost_per_tyre * qty) aggregated per site.',
    formula: 'per site: sum(cost_per_tyre * qty)',
    unit: 'currency', sourceTables: ['tyre_records'],
    filters: { country: 'scoped', groupBy: 'site' },
    target: null, owner: 'Procurement', direction: LOWER,
    compute: 'computeSiteMetrics', computeModule: 'analyticsEngine',
  },
  {
    key: 'pressure_compliance', name: 'Pressure Compliance',
    definition: 'Share of non-cancelled inspections completed with recorded findings (pressure-check proxy).',
    formula: '(compliant inspections / non-cancelled inspections) * 100',
    unit: 'percent', sourceTables: ['inspections'],
    filters: { country: 'scoped', exclude: "status = 'Cancelled'" },
    target: 90, owner: 'Operations', direction: HIGHER,
    compute: 'computePressureCompliance', computeModule: 'kpiEngine',
  },
  {
    key: 'inspection_compliance', name: 'Inspection Compliance',
    definition: 'Share of scheduled inspections completed on time.',
    formula: '(on-time done / scheduled non-cancelled) * 100',
    unit: 'percent', sourceTables: ['inspections'],
    filters: { country: 'scoped', exclude: "status = 'Cancelled'" },
    target: 95, owner: 'Operations', direction: HIGHER,
    compute: 'computeInspectionCompliance', computeModule: 'kpiEngine',
  },
  {
    key: 'tyre_failure_rate', name: 'Tyre Failure Rate',
    definition: 'Share of tyre records at High or Critical risk level.',
    formula: '(High + Critical) / total records',
    unit: 'ratio', sourceTables: ['tyre_records'],
    filters: { country: 'scoped' },
    target: null, owner: 'Reliability Engineering', direction: LOWER,
    compute: 'computeFailureRate', computeModule: 'kpiEngine',
  },
  {
    key: 'warranty_recovery_rate', name: 'Warranty Recovery Rate',
    definition: 'Share/value of warranty claims recovered (Approved credit) vs total claims raised.',
    formula: 'sum(credit_amount where claim_status=Approved) / count(claims)',
    unit: 'percent', sourceTables: ['warranty_claims'],
    filters: { country: 'scoped' },
    target: null, owner: 'Procurement', direction: HIGHER,
    compute: null, computeModule: null,
    notes: 'No pure engine fn exists yet; compute intentionally null (flagged, no fabricated math).',
  },
  {
    key: 'downtime', name: 'Vehicle Downtime (Tyre)',
    definition: 'Estimated vehicle downtime hours attributable to tyre replacements.',
    formula: 'per asset: replacements * hoursPerReplacement (default 2); sum across fleet',
    unit: 'hours', sourceTables: ['tyre_records'],
    filters: { country: 'scoped', groupBy: 'asset_no' },
    target: null, owner: 'Fleet Operations', direction: LOWER,
    compute: 'computeVehicleDowntimeImpact', computeModule: 'kpiEngine',
  },
  {
    key: 'accident_loss_recovery', name: 'Accident Loss Recovery',
    definition: 'Recovered amount vs claim/repair exposure from accidents.',
    formula: 'sum(recovered_amount) / sum(claim_amount)',
    unit: 'percent', sourceTables: ['accidents'],
    filters: { country: 'scoped' },
    target: null, owner: 'Risk & Claims', direction: HIGHER,
    compute: null, computeModule: null,
    notes: 'No pure engine fn exists yet; compute intentionally null (flagged, no fabricated math).',
  },
  {
    key: 'stock_availability', name: 'Stock Availability',
    definition: 'Availability of tyre stock to meet demand (fill rate / on-hand vs required).',
    formula: 'on-hand vs required; stock-source definition pending',
    unit: 'percent', sourceTables: ['stock_records'],
    filters: { country: 'scoped' },
    target: null, owner: 'Procurement', direction: HIGHER,
    compute: null, computeModule: null,
    notes: 'No stock/inventory engine fn exists yet; compute intentionally null (flagged, no fabricated math).',
  },
  {
    key: 'supplier_performance', name: 'Supplier Performance',
    definition: 'Composite supplier/brand score from CPK, failure rate, avg life and scrap.',
    formula: 'composite of CPK, failure rate, avg life; ranked',
    unit: 'score', sourceTables: ['tyre_records', 'suppliers'],
    filters: { country: 'scoped', groupBy: 'brand' },
    target: null, owner: 'Procurement', direction: HIGHER,
    compute: 'computeVendorPerformance', computeModule: 'kpiEngine',
    notes: 'Engine fn is brand-proxied; a supplier-table join is the future enhancement (see supplierScorecard).',
  },
  {
    key: 'overdue_corrective_actions', name: 'Overdue Corrective Actions',
    definition: 'Count of open corrective actions past their due_date.',
    formula: 'count(status != Closed AND due_date < now)',
    unit: 'count', sourceTables: ['corrective_actions'],
    filters: { country: 'scoped', condition: "status != 'Closed' AND due_date < now()" },
    target: 0, owner: 'QA / Reliability', direction: LOWER,
    compute: 'computeMonthlyKpiActuals', computeModule: 'analyticsEngine',
    notes: 'computeMonthlyKpiActuals returns overdueActions for a month; whole-fleet count derivable from the same source.',
  },
])

const _byKey = Object.freeze(
  KPI_REGISTRY.reduce((acc, k) => { acc[k.key] = k; return acc }, Object.create(null)),
)

/** Resolve a single KPI descriptor by key. Returns null when unknown. */
export function getKpi(key) {
  if (typeof key !== 'string' || !key) return null
  return _byKey[key] ?? null
}

/** Return all KPI descriptors (frozen registry array). */
export function listKpis() {
  return KPI_REGISTRY
}

export default KPI_REGISTRY
