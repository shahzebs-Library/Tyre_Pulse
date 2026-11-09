import { describe, it, expect } from 'vitest'
import { isStrongSerial } from '../lib/tyreLifetime'

// SHARED VECTORS: the same table is pinned in mobile/__tests__/tyrePurchase.test.ts.
// If either side's serial rule changes, one of the two tests fails.
export const SERIAL_VECTORS = {"YMA55310":true,"K507B403860":true,"EP0604207":true,"AB12":false,"NO SERIAL":false,"DOT18E56":false,"000000":false,"12.00R24":false,"195 R 15":false,"FEB-62":false,"123456":false,"111111":false,"A1,B2":false,"1.25121E+11":false,"315/80R22.5":false," ym123456 ":true,"NULL123":false,"N/A":false,"26C0004883":true,"":false}

describe('serial rule vectors shared with mobile/lib/tyrePurchase.ts', () => {
  it('web isStrongSerial matches the pinned table', () => {
    for (const [v, want] of Object.entries(SERIAL_VECTORS)) expect(isStrongSerial(v), JSON.stringify(v)).toBe(want)
  })
})
