// Regression: saving the job card form set Parts Cost to 0 on every imported
// job card (a stored cost with no parts lines typed in the app), because the
// cost was derived from an empty list and written unconditionally.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(__dirname, '../pages/WorkOrders.jsx'), 'utf8').replace(/\r\n/g, '\n')

describe('work order save keeps a stored parts cost', () => {
  it('never writes parts_cost unconditionally', () => {
    expect(src).not.toMatch(/^\s*payload\.parts_cost = partsTotal\(formData\.parts_used\)\s*$/m)
  })
  it('writes parts columns only on create, with lines, or when lines existed before', () => {
    expect(src).toMatch(/if \(!editOrder \|\| partsLines\.length > 0 \|\| hadPartsLines\) \{\s*payload\.parts_cost = partsTotal\(partsLines\)\s*payload\.parts_used = partsLines\s*\}/)
  })
})
