import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGE_DIR = 'src/pages'
const OUTPUT = 'audit/module-depth-classification-2026-08-30.json'

const composed = {
  ProductionM3: ['LedgerPage', 'ProductionMonthlySummary', 'ProductionRejectionsPanel', 'StationMapPanel'],
  SanyInvoices: ['LedgerPage', 'LedgerMonthlySummary', 'SanyInvoiceLinesModal'],
  ScoCosts: ['LedgerPage', 'LedgerMonthlySummary'],
  SitesIntake: ['LedgerPage'],
  MasterAccessControl: ['PermissionMatrix', 'CustomRolesManager', 'AccessGrantsManager', 'SecurityCenter'],
  ErpSync: ['ErpConnectionPanel', 'WebhooksPanel'],
  ReportSharing: ['ReportSharesPanel'],
}

const nonList = {
  AccidentPortalView: 'Anonymous singleton snapshot, not a collection. It has secure unavailable and retry states.',
  DataDeletion: 'Public static policy and request instructions; no remote collection.',
  Login: 'Authentication form; list empty state is not applicable.',
  NotFound: 'Static route fallback.',
  Privacy: 'Static public policy.',
  ResetPassword: 'Authentication recovery form; list empty state is not applicable.',
  RoiCalculator: 'Pure client-side calculator driven by operator inputs.',
  TcoCalculator: 'Pure client-side calculator driven by operator inputs.',
  CostScenarioPlanner: 'Pure client-side scenario model driven by operator inputs.',
  BrandAssets: 'Static committed design-system registry browser.',
}

const remediated = {
  AccidentPortalView: 'Transport failures fail closed with generic copy and retry; token/database details are not exposed.',
  Alerts: 'A failed safety source now aborts the scan; the page never renders a false all-clear and offers retry.',
  CpkIntelligence: 'Core and advanced reads expose blocking/partial error states with retry.',
  CostPerM3: 'The primary RPC has a blocking retry state; supporting-source failures are identified as partial.',
  DailyOps: 'All five source outcomes are classified; total failure blocks conclusions and partial failure qualifies totals.',
  GatePass: 'Today/history/site/clearance reads now expose loading, error and retry states; asset rows drill into vehicle records.',
}

const verifiedCustomState = new Set([
  'AiCostMonitor', 'ClaimsSummary', 'Combinations', 'Contracts', 'Customers', 'DigitalTwin',
  'FleetMaster', 'HeatIntelligence', 'OdometerLogs', 'PartsCatalog', 'RepairRequests',
  'RetreadClaims', 'SecurityCenter', 'ShiftScheduling', 'SpeedLimiter', 'TyreServiceEvents',
  'WorkshopSettings', 'ErpIntake', 'Settings', 'UploadData',
])

const excludedOwnership = {
  ExpenseImport: 'Owned by the separate enterprise paging/filter remediation stream; intentionally not modified or adjudicated here.',
}

function signals(text) {
  const has = (re) => re.test(text)
  return {
    data: has(/\.\.\/lib\/|supabase|useQuery\(/),
    loading: has(/LoadingState|\bloading\b|isLoading|refreshing|rows\s*===?\s*null/),
    error: has(/ErrorState|\berror\b|ErrorCard|toUserMessage|failedSources/),
    empty: has(/EmptyState|No data|No records|No rows|No matches|No .* (?:found|recorded|logged)|\.length\s*===?\s*0|!\w+\.length/),
    retry: has(/Retry|Try again|onRetry|retry/i),
    drillDown: has(/<Link|navigate\(|href=|to=\{/),
  }
}

const pages = readdirSync(PAGE_DIR).filter((name) => name.endsWith('.jsx')).map((file) => {
  const page = file.replace(/\.jsx$/, '')
  const text = readFileSync(join(PAGE_DIR, file), 'utf8')
  const lineCount = text.split(/\r?\n/).length
  const state = signals(text)
  const candidateReasons = []
  if (lineCount < 180) candidateReasons.push('short-file')
  if (state.data && !state.empty) candidateReasons.push('heuristic-missing-empty')
  if (state.data && !state.error) candidateReasons.push('heuristic-missing-error')
  if (state.data && !state.loading) candidateReasons.push('heuristic-missing-loading')
  if (!candidateReasons.length && !remediated[page]) return null

  if (remediated[page]) return {
    page, lineCount, candidateReasons, classification: page === 'AccidentPortalView' ? 'operational-singleton' : 'operational-data', status: 'remediated',
    evidence: remediated[page], state,
  }
  if (composed[page]) return {
    page, lineCount, candidateReasons, classification: 'composed-workflow', status: 'not-thin',
    engines: composed[page], evidence: `Page delegates to ${composed[page].join(', ')}; assess the rendered engine, not wrapper line count.`, state,
  }
  if (nonList[page]) return {
    page, lineCount, candidateReasons, classification: 'non-list-or-static', status: 'not-applicable',
    evidence: nonList[page], state,
  }
  if (excludedOwnership[page]) return {
    page, lineCount, candidateReasons, classification: 'external-workstream', status: 'ownership-excluded',
    evidence: excludedOwnership[page], state,
  }
  if (verifiedCustomState.has(page)) return {
    page, lineCount, candidateReasons, classification: 'operational-data', status: 'verified-custom-state',
    evidence: 'Source review confirms explicit loading/sentinel, error/retry, and true-empty or filtered-empty handling; the legacy keyword heuristic missed its implementation vocabulary.', state,
  }
  return {
    page, lineCount, candidateReasons, classification: 'requires-workflow-review', status: 'pending-review',
    evidence: 'Static keyword evidence is insufficient; this page requires an authenticated workflow review before certification.', state,
  }
}).filter(Boolean)

const counts = pages.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1
  return acc
}, {})

const output = {
  generatedAt: new Date().toISOString(),
  scope: 'Legacy thin/data-without-state candidates only; table paging is classified separately.',
  methodology: {
    rule: 'Classify the rendered workflow and delegated engine, never file length alone.',
    limitations: 'Static source evidence does not certify tenant authorization, deployed schema, or live browser behavior.',
  },
  counts,
  unresolved: pages.filter((row) => row.status === 'pending-review').map((row) => row.page),
  pages,
}

mkdirSync('audit', { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({ output: OUTPUT, counts, unresolved: output.unresolved }, null, 2))
