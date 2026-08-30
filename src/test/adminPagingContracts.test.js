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

describe('admin and configuration registers expose all rows through shared paging', () => {
  for (const file of SURFACES) {
    it(`${file} uses the shared paging contract`, () => {
      const source = read(file)
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

  it('Site Management pages both the site register and each expanded asset register', () => {
    const source = read('SiteManagement.jsx')
    expect(source).toContain('const sitesPager = usePagedRows(filtered')
    expect(source).toContain('const pager = usePagedRows(assets')
    expect(source).toContain('sitesPager.pageRows.map')
    expect(source).toContain('pager.pageRows.map')
  })
})
