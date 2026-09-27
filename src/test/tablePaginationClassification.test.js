import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = relative => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n')

describe('frozen table-without-pagination audit classification', () => {
  const manifest = JSON.parse(read('audit/table-pagination-classification-2026-08-30.json'))

  it('classifies every one of the original 153 candidates exactly once', () => {
    expect(manifest.baselineCandidateCount).toBe(153)
    expect(manifest.candidates).toHaveLength(153)
    expect(new Set(manifest.candidates.map(candidate => candidate.page)).size).toBe(153)
    expect(Object.values(manifest.counts).reduce((sum, count) => sum + count, 0)).toBe(153)
  })

  it('fails closed and leaves no unresolved dynamic table after remediation', () => {
    const unsafe = manifest.candidates.filter(candidate => candidate.classification === 'unsafe/unbounded')
    expect(unsafe).toHaveLength(0)
    expect(manifest.counts['unsafe/unbounded']).toBe(0)
    for (const candidate of unsafe) {
      expect(candidate.evidence.length).toBeGreaterThan(0)
      expect(candidate.evidence.every(item => /line \d+/.test(item))).toBe(true)
    }
  })

  it('records the separately-owned filter pages without modifying them here', () => {
    expect(manifest.excludedFromRemediationOwnership).toEqual(expect.arrayContaining([
      'DataReconciliation',
      'ExpenseImport',
      'MaintenanceCostBoard',
    ]))
  })
})

describe('AI administration shared table family', () => {
  const source = read('src/pages/AiAdministration.jsx')

  it('pages all four resource tables through the shared EnterpriseTable register', () => {
    // The four catalogue tabs moved from a hand-built <table> + TablePagination
    // onto ONE ResourceTable wrapper over EnterpriseTable, which pages and sorts
    // across the whole filtered set.
    expect(source).toContain("import EnterpriseTable from '../components/ui/EnterpriseTable'")
    expect(source).toContain('<EnterpriseTable')
    expect(source).not.toContain('<table')
    expect((source.match(/<ResourceTable\b/g) || [])).toHaveLength(4)
    expect((source.match(/rows=\{filtered\}/g) || [])).toHaveLength(4)
  })

  it('keeps exports scoped to each full filtered result rather than the visible page', () => {
    expect(source).not.toMatch(/exportTo(?:Excel|Pdf)\([^)]*pageRows/s)
    expect((source.match(/const exportRows = filtered\.map/g) || [])).toHaveLength(4)
    expect(source).toMatch(/exportToExcel\(exportRows/)
  })
})

describe('production-risk registers remediated in this paging wave', () => {
  const pages = [
    'AccessGrantsManager', 'AdvancedSearch', 'AssetBreakdowns', 'ChecklistSchedules',
    'Checklists', 'ClaimsSummary', 'Contracts', 'FleetUtilization', 'FuelCards',
    'Geofencing', 'IncidentReports', 'InsuranceClaims', 'MyChecklists',
    'PolicyManagement', 'RepairRequests', 'RetreadClaims', 'ScheduledReports',
    'AiAnalytics', 'ChecklistInsights', 'ContinuousImprovement', 'CorrectiveActions',
    'CustomRolesManager', 'EngineeringKpi', 'GatePass', 'PerformanceBenchmark',
    'TcoCalculator', 'WorkshopAnalytics', 'WorkshopTv', 'AssetDisposals',
    'PartsCatalog', 'RecallDetail', 'RecallTracker', 'StockManagement',
    'StockReplenishment', 'SupplierManagement', 'UserManagement',
  ]

  const ENTERPRISE_PAGES = new Set(['Geofencing', 'IncidentReports', 'FuelCards', 'GatePass', 'ChecklistSchedules', 'Checklists', 'Contracts', 'AssetDisposals', 'PolicyManagement', 'TcoCalculator', 'ContinuousImprovement', 'ScheduledReports', 'RecallTracker', 'RepairRequests', 'InsuranceClaims', 'RetreadClaims', 'WorkshopAnalytics', 'EngineeringKpi', 'AdvancedSearch', 'AssetBreakdowns'])
  // MyChecklists + PerformanceBenchmark moved their registers onto EnterpriseTable.
  for (const p of ['MyChecklists', 'PerformanceBenchmark']) ENTERPRISE_PAGES.add(p)

  for (const page of pages) {
    it(`${page} renders through the shared pager`, () => {
      const source = read(`src/pages/${page}.jsx`)
      expect(source).not.toMatch(/exportTo(?:Excel|Pdf)\([\s\S]{0,160}?\.pageRows/)
      // Registers moved onto EnterpriseTable page the WHOLE set inside the
      // table (and sort across it); they must not clip rows before handing in.
      if (ENTERPRISE_PAGES.has(page)) {
        expect(source).toContain('<EnterpriseTable')
        expect(source).not.toMatch(/\.slice\(0,\s*\d+\)\.map/)
        return
      }
      expect(source).toContain('usePagedRows')
      expect(source).toContain('<TablePagination')
    })
  }

  it('RepairRequests no longer hides history after row 500', () => {
    // Both registers now hand the WHOLE set to EnterpriseTable, which pages
    // and sorts across it, so nothing past row 500 is dropped.
    const source = read('src/pages/RepairRequests.jsx')
    expect(source).not.toContain('filteredCards.slice(0, 500)')
    expect(source).toContain('data={filteredCards}')
    expect(source).toContain('data={sortedQueue}')
  })

  it('every bounded certification carries source anchors, not a bare assertion', () => {
    const manifest = JSON.parse(read('audit/table-pagination-classification-2026-08-30.json'))
    const certified = manifest.candidates.filter(candidate =>
      candidate.classification === 'intentionally-bounded/small' &&
      candidate.evidence.some(item => item.startsWith('Source anchors:')),
    )
    expect(certified.length).toBeGreaterThanOrEqual(6)
    for (const candidate of certified) {
      expect(candidate.evidence.join(' ')).toContain('Source anchors:')
    }
  })
})
