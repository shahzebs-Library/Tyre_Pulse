/**
 * Tyre Specifications workbench tabs: Fleet compliance, Non-conformance, Quick
 * setup, Fitment policy, Value advisor and Audit trail. Moved out of the page
 * unchanged; each tab reads the page's state and handlers from `ctx`, so the
 * data, exports and workflows behave exactly as before.
 */
import { motion } from 'framer-motion'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  Plus, Search, FileText, FileSpreadsheet, Edit2, Trash2, X, CheckCircle, AlertTriangle, AlertOctagon, ChevronLeft, ChevronRight, RefreshCw, History, Zap, Truck, Info, BarChart3, BookOpen, Scale, DollarSign, TrendingDown, Award, Gauge, Package,
} from 'lucide-react'
import Card from '../ui/Card'
import EmptyState from '../EmptyState'
import { SMART_DEFAULTS } from '../../lib/tyreSpecCatalog'
import {
  BrandGuidancePanel, CHART_OPTS, HISTORY_COLUMNS, PAGE_SIZE, SIZE_INVENTORY_COLUMNS, STATUS_CONFIG, SpecTable, advisorColumns, policyTableModel,
} from './parts'

ChartJS.register(ArcElement, Tooltip, Legend)

export function ComplianceTab({ ctx }) {
  const {
    compPage, compSearch, compSiteFilter, compStatusFilter, compTypeFilter, complianceCols, complianceData, compliancePage, complianceTotalPages, doughnutData, filteredCompliance, loadingRecords, setCompPage, setCompSearch, setCompSiteFilter, setCompStatusFilter, setCompTypeFilter, siteOptions, typeOptions,
  } = ctx
  return (
    <div className="space-y-4">

            {/* Chart + Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* `flex flex-col` was redundant even before the migration -
                  Card is a flex column natively, which is what lets the chart
                  well below take the remaining height via `flex-1`. The chart
                  is a canvas, not a DOM overlay, so this card needs no clip. */}
              <Card>
                <p className="text-[var(--text-muted)] text-sm font-medium mb-3 flex items-center gap-2"><BarChart3 size={14} /> Compliance Breakdown</p>
                <div className="flex-1 min-h-[180px]">
                  {complianceData.length > 0 ? (
                    <Doughnut data={doughnutData} options={CHART_OPTS} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No data</div>
                  )}
                </div>
              </Card>

              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
                {Object.entries({
                  Approved: complianceData.filter(r => r.specStatus === 'Approved').length,
                  'Non-Standard Size': complianceData.filter(r => r.specStatus === 'Non-Standard Size').length,
                  'Non-Approved Brand': complianceData.filter(r => r.specStatus === 'Non-Approved Brand').length,
                  'Multiple Violations': complianceData.filter(r => r.specStatus === 'Multiple Violations').length,
                  'No Spec Defined': complianceData.filter(r => r.specStatus === 'No Spec Defined').length,
                }).map(([status, count]) => {
                  const cfg = STATUS_CONFIG[status]
                  const Icon = cfg.icon
                  const pct = complianceData.length > 0 ? Math.round((count / complianceData.length) * 100) : 0
                  return (
                    <div key={status} className={`bg-[var(--surface-1)] border rounded-xl p-3 ${cfg.bg}`}>
                      <div className={`flex items-center gap-1.5 mb-1 ${cfg.color}`}>
                        <Icon size={13} />
                        <span className="text-xs font-medium">{status}</span>
                      </div>
                      <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
                      <p className="text-[var(--text-muted)] text-xs">{pct}% of fleet</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Compliance Table Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={compSearch}
                  onChange={e => { setCompSearch(e.target.value); setCompPage(0) }}
                  placeholder="Search asset or vehicle type..."
                  className="w-full pl-9 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-[var(--text-primary)] text-sm focus:border-blue-500 outline-none"
                />
              </div>
              <select value={compSiteFilter} onChange={e => { setCompSiteFilter(e.target.value); setCompPage(0) }} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none">
                <option value="">All Sites</option>
                {siteOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={compTypeFilter} onChange={e => { setCompTypeFilter(e.target.value); setCompPage(0) }} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none">
                <option value="">All Vehicle Types</option>
                {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={compStatusFilter} onChange={e => { setCompStatusFilter(e.target.value); setCompPage(0) }} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] text-sm focus:border-blue-500 outline-none">
                <option value="">All Statuses</option>
                {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Compliance Table */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              {loadingRecords ? (
                <div className="py-16 text-center">
                  <RefreshCw size={24} className="animate-spin text-[var(--text-dim)] mx-auto mb-3" />
                  <p className="text-[var(--text-muted)] text-sm">Loading fleet data...</p>
                </div>
              ) : (
                /* Shared table shell with search/sort/export OFF: the four filters
                   above and the PAGE_SIZE pager below stay the only controls, and
                   `exportCompliancePdf` still walks the full `filteredCompliance`. */
                <>
                    <SpecTable
                      columns={complianceCols}
                      data={compliancePage}
                      getRowId={(r, i) => `${r.id}-${i}`}
                      emptyMessage="No records match filters"
                    />

                  {/* Pagination */}
                  {complianceTotalPages > 1 && (
                    <div className="px-4 py-3 border-t border-[var(--input-border)] flex items-center justify-between">
                      <p className="text-[var(--text-muted)] text-xs">
                        Showing {compPage * PAGE_SIZE + 1}-{Math.min((compPage + 1) * PAGE_SIZE, filteredCompliance.length)} of {filteredCompliance.length}
                      </p>
                      <div className="flex gap-1">
                        <button onClick={() => setCompPage(p => Math.max(0, p - 1))} disabled={compPage === 0} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">
                          <ChevronLeft size={15} />
                        </button>
                        {Array.from({ length: Math.min(complianceTotalPages, 7) }, (_, i) => {
                          const pg = complianceTotalPages <= 7 ? i : compPage <= 3 ? i : compPage >= complianceTotalPages - 4 ? complianceTotalPages - 7 + i : compPage - 3 + i
                          return (
                            <button key={pg} onClick={() => setCompPage(pg)} className={`w-7 h-7 rounded text-xs transition-colors ${compPage === pg ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'}`}>{pg + 1}</button>
                          )
                        })}
                        <button onClick={() => setCompPage(p => Math.min(complianceTotalPages - 1, p + 1))} disabled={compPage >= complianceTotalPages - 1} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors">
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
    </div>
  )
}

export function NonConformanceTab({ ctx }) {
  const {
    loadingRecords, nonConformanceByAsset, nonConformanceCols, nonConformanceRanked,
  } = ctx
  return (
    <div className="space-y-4">

            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                <p className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-2">
                  <AlertOctagon size={15} className="text-red-400" />
                  Non-Conformance Report, Grouped by Asset
                </p>
                <span className="text-[var(--text-muted)] text-xs">{nonConformanceByAsset.length} vehicles with violations</span>
              </div>

              {loadingRecords ? (
                <div className="py-12 text-center">
                  <RefreshCw size={24} className="animate-spin text-[var(--text-dim)] mx-auto mb-3" />
                  <p className="text-[var(--text-muted)] text-sm">Analysing fleet...</p>
                </div>
              ) : nonConformanceByAsset.length === 0 ? (
                <EmptyState
                  illustration="state/success"
                  icon={CheckCircle}
                  title="Full Compliance"
                  description="No non-conforming fitments detected across the fleet."
                />
              ) : (
                <SpecTable
                  columns={nonConformanceCols}
                  data={nonConformanceRanked}
                  getRowId={(r) => String(r.asset_no)}
                  emptyMessage="No non-conforming fitments"
                />
              )}
            </div>
    </div>
  )
}

export function QuickSetupTab({ ctx }) {
  const {
    importQuickDefault, isAdmin, specs,
  } = ctx
  return (
    <div className="space-y-4">

            <Card className="items-start gap-3" style={{ flexDirection: 'row' }}>
              <Info size={16} className="text-blue-400 mt-0.5 shrink-0" />
              <p className="text-[var(--text-secondary)] text-sm">
                Industry-standard tyre specification defaults. Click <strong>Import</strong> to add any profile to your specification library. Already-imported specs are greyed out.
              </p>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {SMART_DEFAULTS.map((def, i) => {
                const alreadyImported = specs.some(s => s.vehicle_type === def.vehicle_type && s.position === def.position)
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`bg-[var(--surface-1)] border rounded-xl p-4 transition-colors ${alreadyImported ? 'border-[var(--input-border)] opacity-50' : 'border-[var(--input-border)] hover:border-blue-700'}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <Zap size={13} className="text-yellow-400" />
                          <span className="text-[var(--text-primary)] font-medium text-sm">{def.vehicle_type}</span>
                        </div>
                        <span className="text-xs text-[var(--text-muted)] bg-[var(--input-bg)] px-2 py-0.5 rounded-full">{def.position}</span>
                      </div>
                      {alreadyImported ? (
                        <span className="flex items-center gap-1 text-xs text-green-400 bg-green-900/20 border border-green-800 px-2 py-1 rounded-lg">
                          <CheckCircle size={10} /> Imported
                        </span>
                      ) : (
                        isAdmin && (
                          <button
                            onClick={() => importQuickDefault(def)}
                            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <Plus size={11} /> Import
                          </button>
                        )
                      )}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-[var(--text-muted)] text-xs mb-1">Approved Sizes</p>
                        <div className="flex flex-wrap gap-1">
                          {def.approved_sizes.map(s => <span key={s} className="text-xs bg-blue-900/30 text-blue-300 border border-blue-800 px-2 py-0.5 rounded-full">{s}</span>)}
                        </div>
                      </div>
                      <div>
                        <p className="text-[var(--text-muted)] text-xs mb-1">Approved Brands</p>
                        <div className="flex flex-wrap gap-1">
                          {def.approved_brands.map(b => <span key={b} className="text-xs bg-purple-900/30 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full">{b}</span>)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--input-border)]">
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">PSI</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.recommended_pressure}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">Min Tread</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.min_tread_depth}mm</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">Load/Speed</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.min_load_index}{def.min_speed_index}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[var(--text-muted)] text-xs">Ply</p>
                          <p className="text-[var(--text-primary)] text-sm font-semibold">{def.ply_rating || 'N/A'}</p>
                        </div>
                      </div>
                      <p className="text-[var(--text-dim)] text-xs pt-1">{def.notes}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
    </div>
  )
}

export function FitmentPolicyTab({ ctx }) {
  const {
    downloadPolicyPdf, exportSizeInventoryExcel, filteredSizeInventory, loadingRecords, policyBusy, policyError, policySections, setPolicyError, setSizeSearch, sizeInventory, sizeSearch, specs,
  } = ctx
  return (
    <div className="space-y-4">

            {/* Intro + download. The direction is RESPONSIVE here, and its base
                (column) is already Card's own, so no inline `flexDirection` is
                needed: Tailwind emits `sm:flex-row` after the unprefixed
                `flex-col` Card carries, so the variant still wins at >=sm. */}
            <Card className="sm:flex-row sm:items-center gap-4">
              <div className="p-2.5 rounded-lg bg-[var(--input-bg)] text-blue-400 shrink-0">
                <FileText size={20} />
              </div>
              <div className="flex-1">
                <p className="text-[var(--text-primary)] font-medium text-sm mb-1">Tyre Fitment and Specification Policy</p>
                <p className="text-[var(--text-muted)] text-sm">
                  Generate a standardized, company-branded policy document that defines the approved
                  tyre fitment standards every workshop and fitter must follow. It compiles the current
                  specification library into an official reference for procurement, fitment and audit.
                </p>
              </div>
              <button
                onClick={downloadPolicyPdf}
                disabled={policyBusy}
                className="btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {policyBusy ? <RefreshCw size={15} className="animate-spin" /> : <FileText size={15} />}
                {policyBusy ? 'Generating...' : 'Download Policy (PDF)'}
              </button>
            </Card>

            {policyError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} /> {policyError}
                <button onClick={() => setPolicyError('')} className="ml-auto"><X size={14} /></button>
              </div>
            )}

            {specs.length === 0 && (
              <div className="bg-amber-900/20 border border-amber-800 text-amber-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <Info size={14} className="shrink-0" />
                No specifications defined yet. The governance sections below still apply; adding specs in
                the Specification Library will populate the Approved Fitment Standards table.
              </div>
            )}

            {/* Current Fleet Tyres by Size */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 flex items-start gap-2.5">
                  <div className="p-1.5 rounded-lg bg-[var(--input-bg)] text-purple-400 shrink-0 mt-0.5">
                    <Gauge size={15} />
                  </div>
                  <div>
                    <p className="text-[var(--text-primary)] font-medium text-sm">Current Fleet Tyres by Size</p>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5">
                      Every tyre size currently fitted anywhere in the fleet, with the brands in use,
                      the approved brand list and the ply rating, minimum tread, load index, speed
                      index and recommended pressure that apply. Grouped from live tyre records
                      directly, so it covers every vehicle type, site and country in scope. Included as
                      an appendix in the downloaded policy PDF.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      value={sizeSearch}
                      onChange={e => setSizeSearch(e.target.value)}
                      placeholder="Search size, brand, type..."
                      className="pl-8 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-[var(--text-primary)] text-xs w-48 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <button
                    onClick={exportSizeInventoryExcel}
                    disabled={filteredSizeInventory.length === 0}
                    title={filteredSizeInventory.length === 0 ? 'No rows to export' : `Exports ${filteredSizeInventory.length} size(s)`}
                    className="flex items-center gap-1.5 bg-[var(--input-bg)] hover:bg-gray-700 text-[var(--text-secondary)] text-xs px-3 py-1.5 rounded-lg border border-[var(--input-border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <FileSpreadsheet size={13} /> Export
                  </button>
                </div>
              </div>

              {loadingRecords ? (
                <div className="p-6 text-center text-[var(--text-muted)] text-sm">Loading current tyre fitments...</div>
              ) : filteredSizeInventory.length === 0 ? (
                <div className="p-6 text-center text-[var(--text-muted)] text-sm">
                  {sizeInventory.length === 0
                    ? 'No current tyre fitments are on record yet for this scope.'
                    : 'No sizes match your search.'}
                </div>
              ) : (
                /* Search and Excel export stay the panel header controls above;
                   the table shell has its own search and export switched off. */
                <SpecTable
                  columns={SIZE_INVENTORY_COLUMNS}
                  data={filteredSizeInventory}
                  getRowId={(r) => String(r.size)}
                  emptyMessage="No sizes match your search."
                />
              )}
            </div>

            {/* Live preview */}
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                <p className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-2">
                  <BookOpen size={15} className="text-blue-400" /> Policy Preview
                </p>
                <span className="text-[var(--text-muted)] text-xs">{policySections.length} sections</span>
              </div>

              <div className="p-4 space-y-4">
                {policySections.length === 0 ? (
                  <p className="text-[var(--text-muted)] text-sm">Policy content will appear here.</p>
                ) : (
                  <ol className="space-y-3">
                    {policySections.map((section, idx) => (
                      <li key={section.n ?? idx} className="border-l-2 border-[var(--input-border)] pl-4">
                        <p className="text-[var(--text-primary)] text-sm font-semibold mb-1">
                          {section.n != null ? `${section.n}. ` : ''}{section.title}
                        </p>
                        {section.body && (
                          <p className="text-[var(--text-muted)] text-xs whitespace-pre-line">{section.body}</p>
                        )}
                        {section.table && (() => {
                          const { columns: policyCols, rows: policyRows } = policyTableModel(section.table)
                          if (policyRows.length === 0) {
                            return <p className="text-[var(--text-dim)] text-xs">No approved standards recorded yet.</p>
                          }
                          return (
                            <div className="mt-2 border border-[var(--input-border)] rounded-lg overflow-hidden">
                              <SpecTable columns={policyCols} data={policyRows} getRowId={(r) => r.__key} maxHeight={420} />
                            </div>
                          )
                        })()}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
    </div>
  )
}

export function ValueAdvisorTab({ ctx }) {
  const {
    advisorRecs, approvedBrandsFor, canManageQuotes, exportAdvisorExcel, fetchAdvisorData, loadingOptions, optionsError, setDeletingQuote, setEditingQuote, setOptionsError, setShowQuoteModal, specs,
  } = ctx
  return (
    <div className="space-y-4">

            {/* Intro / method card. Responsive direction again - the column
                base is Card's own, so only the `lg:` half is needed. */}
            <Card className="lg:flex-row lg:items-center gap-4">
              <div className="p-2.5 rounded-lg bg-[var(--input-bg)] text-emerald-400 shrink-0">
                <Scale size={20} />
              </div>
              <div className="flex-1">
                <p className="text-[var(--text-primary)] font-medium text-sm mb-1">Best-Value Procurement Advisor</p>
                <p className="text-[var(--text-muted)] text-sm">
                  Recommendations rank options by lifecycle cost-per-km (price adjusted for expected life,
                  retreads and casing value), grounded in your fleet realized CPK where available. Add supplier
                  quotes to compare deals per approved fitment. Where no quotes exist yet, brand-economics
                  guidance is shown instead.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={exportAdvisorExcel}
                  disabled={advisorRecs.length === 0}
                  className="flex items-center gap-2 bg-[var(--input-bg)] hover:bg-gray-700 text-[var(--text-secondary)] text-sm px-3 py-2 rounded-lg border border-[var(--input-border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet size={14} /> Export
                </button>
                <button
                  onClick={() => { setEditingQuote(null); setShowQuoteModal(true) }}
                  disabled={!canManageQuotes}
                  title={!canManageQuotes ? 'Manager access or above required' : ''}
                  className="btn-primary gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={15} /> Add Quote
                </button>
              </div>
            </Card>

            {optionsError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} /> {optionsError}
                <button onClick={fetchAdvisorData} className="ml-auto flex items-center gap-1 text-red-200 hover:text-[var(--text-primary)]"><RefreshCw size={13} /> Retry</button>
                <button onClick={() => setOptionsError('')}><X size={14} /></button>
              </div>
            )}

            {loadingOptions ? (
              <Card className="text-center" style={{ paddingBlock: 'var(--space-12)' }}>
                <RefreshCw size={28} className="animate-spin text-[var(--text-dim)] mx-auto mb-3" />
                <p className="text-[var(--text-muted)] text-sm">Loading supplier quotes...</p>
              </Card>
            ) : advisorRecs.length === 0 ? (
              // Honest empty state: no quotes anywhere. Still useful via brand guidance.
              <div className="space-y-4">
                {/* `py-10` is dead on a Card for the same reason as `py-16`
                    above, so the block padding moves to `style`. The button
                    already carries `mx-auto`, and an auto cross-axis margin
                    beats the flex `stretch` default, so it keeps its natural
                    width without needing `self-center`. */}
                <Card className="text-center" style={{ paddingBlock: 'var(--space-10)' }}>
                  <DollarSign size={40} className="text-[var(--text-dim)] mx-auto mb-3" />
                  <p className="text-[var(--text-muted)] font-medium mb-1">No Supplier Quotes Yet</p>
                  <p className="text-[var(--text-dim)] text-sm mb-4 max-w-md mx-auto">
                    Add supplier quotes to rank options by lifecycle cost-per-km and surface the best deals.
                    Until then, the brand-economics guidance below applies to your approved fitments.
                  </p>
                  {canManageQuotes && (
                    <button onClick={() => { setEditingQuote(null); setShowQuoteModal(true) }} className="btn-primary gap-2 mx-auto">
                      <Plus size={15} /> Add First Quote
                    </button>
                  )}
                </Card>

                {specs.length > 0 && (
                  <div className="space-y-4">
                    {specs.map(spec => (
                      <Card key={spec.id} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Truck size={14} className="text-blue-400" />
                          <span className="text-[var(--text-primary)] font-medium text-sm">{spec.vehicle_type}</span>
                          <span className="text-xs text-[var(--text-muted)] bg-[var(--input-bg)] px-2 py-0.5 rounded-full">{spec.position}</span>
                          {/* Says outright that this is guidance, not a ranking
                              - there are no quotes behind it. */}
                          <span className="ml-auto text-[var(--text-dim)] text-xs flex items-center gap-1"><Info size={11} /> Brand-economics guidance</span>
                        </div>
                        <BrandGuidancePanel brands={spec.approved_brands} />
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {advisorRecs.map(g => {
                  const { rec } = g
                  const cur = rec.currency
                  const valids = rec.ranked.filter(e => e.valid && e.lifecycleCpk != null)
                  return (
                    <Card key={g.key} className="space-y-4">

                      {/* Header + headline */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-[var(--input-border)] pb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Truck size={14} className="text-blue-400" />
                            <span className="text-[var(--text-primary)] font-semibold text-sm">{g.vehicle_type}</span>
                            <span className="text-xs text-[var(--text-muted)] bg-[var(--input-bg)] px-2 py-0.5 rounded-full">{g.position}</span>
                            <span className="text-xs text-[var(--text-dim)]">{g.options.length} quote{g.options.length === 1 ? '' : 's'}</span>
                          </div>
                          <p className={`text-sm flex items-start gap-1.5 ${rec.hasEnoughData ? 'text-emerald-300' : 'text-[var(--text-muted)]'}`}>
                            <Award size={14} className="mt-0.5 shrink-0" /> {rec.headline}
                          </p>
                        </div>
                      </div>

                      {/* Engineer rationale */}
                      {rec.rationale?.length > 0 && (
                        <div className="bg-[var(--input-bg)] rounded-lg p-3">
                          <p className="text-[var(--text-muted)] text-xs font-medium mb-1.5 flex items-center gap-1"><Info size={11} /> Engineering rationale</p>
                          <ul className="space-y-1">
                            {rec.rationale.map((r, i) => (
                              <li key={i} className="text-[var(--text-secondary)] text-xs flex items-start gap-1.5">
                                <span className="text-emerald-400 mt-0.5">-</span> {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Ranked comparison. The row ORDER is the recommendation (the engine
                          ranks by lifecycle CPK), so the table shell runs with sorting OFF. */}
                      {valids.length > 0 ? (
                        <div className="border border-[var(--input-border)] rounded-lg overflow-hidden">
                          <SpecTable columns={advisorColumns(rec, cur)} data={rec.ranked} getRowId={(r, i) => String(r.id ?? `${r.brand}-${i}`)} maxHeight={480} />
                        </div>
                      ) : (
                        <p className="text-[var(--text-dim)] text-sm">No quote in this fitment has both a unit price and an expected life yet.</p>
                      )}

                      {/* Savings line */}
                      {rec.hasEnoughData && rec.savingsVsPremiumPct ? (
                        <p className="text-emerald-300 text-xs flex items-center gap-1.5">
                          <TrendingDown size={13} /> The pick is {rec.savingsVsPremiumPct}% cheaper per km than the most expensive option in this set.
                          {rec.savingsVsBudgetNote ? <span className="text-[var(--text-muted)]"> {rec.savingsVsBudgetNote}</span> : null}
                        </p>
                      ) : null}

                      {/* Brand guidance fallback when not enough data to rank confidently */}
                      {!rec.hasEnoughData && (
                        <div className="pt-1">
                          <p className="text-[var(--text-muted)] text-xs font-medium mb-2 flex items-center gap-1"><Package size={11} /> Approved-brand economics for this fitment</p>
                          <BrandGuidancePanel brands={approvedBrandsFor(g.vehicle_type, g.position)} />
                        </div>
                      )}

                      {/* Per-quote manage row */}
                      {canManageQuotes && (
                        <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--input-border)]">
                          {g.options.map(o => (
                            <span key={o.id} className="inline-flex items-center gap-1.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-full pl-3 pr-1.5 py-1 text-xs text-[var(--text-secondary)]">
                              {o.brand || 'Quote'}{o.supplier ? ` / ${o.supplier}` : ''}
                              <button onClick={() => { setEditingQuote(o); setShowQuoteModal(true) }} className="p-1 text-[var(--text-muted)] hover:text-blue-400 rounded transition-colors"><Edit2 size={11} /></button>
                              <button onClick={() => setDeletingQuote(o)} className="p-1 text-[var(--text-muted)] hover:text-red-400 rounded transition-colors"><Trash2 size={11} /></button>
                            </span>
                          ))}
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
    </div>
  )
}

export function AuditTrailTab({ ctx }) {
  const {
    historyNewestFirst,
  } = ctx
  return (
    <div className="space-y-4">

            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                <p className="text-[var(--text-primary)] font-medium text-sm flex items-center gap-2">
                  <History size={15} className="text-blue-400" />
                  Specification Change History
                </p>
                <span className="text-[var(--text-muted)] text-xs">Last {Math.min(history.length, 100)} events</span>
              </div>

              {history.length === 0 ? (
                <EmptyState
                  illustration="state/no-data"
                  icon={History}
                  title="No history yet"
                  description="Changes to specifications will be tracked here."
                />
              ) : (
                /* Append-only audit trail read newest-first: its order is the record,
                   so the table shell runs with sorting OFF. */
                <SpecTable
                  columns={HISTORY_COLUMNS}
                  data={historyNewestFirst}
                  getRowId={(r, i) => String(r.id ?? i)}
                  emptyMessage="No history yet"
                />
              )}
            </div>
    </div>
  )
}

