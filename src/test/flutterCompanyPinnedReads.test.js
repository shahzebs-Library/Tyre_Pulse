// Flutter by-number reads must carry the caller's company (organisation_id), so a
// super admin who can see several companies never gets another company's
// same-numbered asset. Source scan: the Dart SDK is not part of the web CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(`tyre_pulse_flutter/lib/${p}`, 'utf8').replace(/\r\n/g, '\n')

const READERS = [
  ['features/scanning/domain/scan_lookup.dart', 3],
  ['features/meter_logs/data/meter_log_repository.dart', 1],
  ['features/checklists/data/checklist_asset_hours_repository.dart', 1],
  ['features/tyres/data/tyre_fitment_repository.dart', 1],
  ['features/inspections/data/inspection_previous_meters.dart', 1],
]

const PROVIDERS = [
  'features/scanning/presentation/scanner_controller.dart',
  'features/meter_logs/meter_logs_providers.dart',
  'features/checklists/checklists_providers.dart',
  'features/tyres/presentation/serial_search_deps.dart',
  'features/inspections/inspections_providers.dart',
]

describe('Flutter reads are pinned to the caller company', () => {
  for (const [file, pins] of READERS) {
    it(`${file} filters on organisation_id`, () => {
      const src = read(file)
      expect(src).toMatch(/final String\? _organisationId;/)
      const n = (src.match(/eq\('organisation_id', org\)/g) || []).length
      expect(n).toBeGreaterThanOrEqual(pins)
    })
  }
  for (const file of PROVIDERS) {
    it(`${file} passes the workspace company`, () => {
      const src = read(file)
      expect(src).toContain('organisationId: ref.watch(workspaceContextProvider)?.companyId')
      expect(src).toContain("core/workspace/workspace_providers.dart")
    })
  }
})
