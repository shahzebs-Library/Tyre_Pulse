import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(ROOT, 'pages', file), 'utf8').replace(/\r\n/g, '\n')

const SURFACES = [
  'AccidentWorkflowSettings.jsx',
  'ApprovalMatrix.jsx',
  'SafetyCompliance.jsx',
  'SecurityCenter.jsx',
  'Settings.jsx',
  'SiteManagement.jsx',
  'ReportShare.jsx',
]

// Pages whose registers moved onto EnterpriseTable, which pages ALL rows
// itself. They must not fall back to a fixed slice either.
const ENTERPRISE_SURFACES = new Set(['SafetyCompliance.jsx', 'ApprovalMatrix.jsx', 'AccidentWorkflowSettings.jsx', 'Settings.jsx', 'ReportShare.jsx', 'SecurityCenter.jsx', 'SiteManagement.jsx'])

describe('admin and configuration registers expose all rows through shared paging', () => {
  for (const file of SURFACES) {
    it(`${file} uses the shared paging contract`, () => {
      const source = read(file)
      if (ENTERPRISE_SURFACES.has(file)) {
        expect(source).toContain('<EnterpriseTable')
        return
      }
      expect(source).toContain('usePagedRows')
      expect(source).toContain('<TablePagination')
    })
  }

  it('Safety Compliance no longer silently clips failure or inspection registers', () => {
    const source = read('SafetyCompliance.jsx')
    expect(source).not.toMatch(/treadFails\.slice\(0,\s*50\)/)
    expect(source).not.toMatch(/inspections\.slice\(0,\s*30\)/)
  })

  it('Report Share no longer hides operational rows behind a twelve-row preview', () => {
    const source = read('ReportShare.jsx')
    expect(source).not.toMatch(/(?:jobs|list)\.slice\(0,\s*12\)/)
    expect(source).not.toContain('Plus {fmtInt(extra)} more')
  })

  it('Site Management hands every site, and every asset at a site, to EnterpriseTable', () => {
    // Both registers moved onto EnterpriseTable, which pages and sorts across
    // the WHOLE set; neither may clip rows before handing them in.
    const source = read('SiteManagement.jsx')
    expect(source).toContain('data={filtered}')
    expect(source).toContain('data={site.assets || []}')
    expect(source).not.toMatch(/\.slice\(0,\s*\d+\)\.map/)
  })
})
