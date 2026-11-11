import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { exportInspectionDetailPdf } from '../lib/exportUtils'

// Reports are written with stream compression on, so inflate each content stream
// before reading the drawn text out of it.
const pdfText = (doc) => {
  const raw = doc.output()
  const parts = [raw]
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { parts.push(inflateSync(Buffer.from(m[1], 'binary')).toString('latin1')) } catch { /* not deflated */ }
  }
  return parts.join('\n')
}

const BASE = {
  id: 'ins-signer-check',
  title: 'Signer example',
  vehicle_type: 'Pickup',
  asset_no: 'TEST-ASSET',
  tyre_conditions: { invalid_slot: { condition: 'Good', pressure: 80 } },
}

describe('inspection PDF sign-off identity', () => {
  it('prints the approver as Full Name (EMP-ID), never the login email or the user id', async () => {
    const doc = await exportInspectionDetailPdf({
      ...BASE,
      approval_status: 'approved',
      approved_at: '2026-11-10T00:00:00Z',
      // what the row actually carries: a login email + a raw user uuid
      approver_email: 'ws123na@gmail.com',
      approved_by: '11111111-2222-4333-8444-555555555555',
      inspector: 'Field Tyreman',
      created_by: '22222222-3333-4444-5555-666666666666',
    }, {
      save: false,
      // what the caller resolves from profiles (approver = approved_by)
      signers: {
        approver: { id: '11111111-2222-4333-8444-555555555555', full_name: 'Anum Shah', employee_id: 'EMP-42' },
        inspector: { id: '22222222-3333-4444-5555-666666666666', full_name: 'Field Tyreman', employee_id: 'EMP-7' },
      },
    })
    const text = pdfText(doc)
    expect(text).toContain('Anum Shah')
    expect(text).toContain('EMP-42')
    // the two things the owner reported as leaking must not appear anywhere
    expect(text).not.toContain('ws123na@gmail.com')
    expect(text).not.toContain('@gmail.com')
    expect(text).not.toContain('11111111-2222-4333-8444-555555555555')
    // and the tyreman is named with the employee id too
    expect(text).toContain('EMP-7')
  })

  it('leaks neither the email nor the uuid when no resolved signer is supplied', async () => {
    const doc = await exportInspectionDetailPdf({
      ...BASE,
      approval_status: 'approved',
      approved_at: '2026-11-10T00:00:00Z',
      approver_email: 'ws123na@gmail.com',
      approved_by: '11111111-2222-4333-8444-555555555555',
    }, { save: false })
    const text = pdfText(doc)
    expect(text).not.toContain('ws123na@gmail.com')
    expect(text).not.toContain('@gmail.com')
    expect(text).not.toContain('11111111-2222-4333-8444-555555555555')
    // with nothing usable the sign-off box reads the honest placeholder
    expect(text).toContain('Not recorded')
  })
})
