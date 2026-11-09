import { isStrongSerial, onePricePerTyre, singleCurrency, moneyText } from '../lib/tyrePurchase'

// SHARED VECTORS: the same table is pinned in src/test/mobileTyrePurchaseMirror.test.js
// (web isStrongSerial). If either side's serial rule changes, one of the two tests fails.
const SERIAL_VECTORS: Record<string, boolean> = {"YMA55310":true,"K507B403860":true,"EP0604207":true,"AB12":false,"NO SERIAL":false,"DOT18E56":false,"000000":false,"12.00R24":false,"195 R 15":false,"FEB-62":false,"123456":false,"111111":false,"A1,B2":false,"1.25121E+11":false,"315/80R22.5":false," ym123456 ":true,"NULL123":false,"N/A":false,"26C0004883":true,"":false}

describe('tyrePurchase (mirror of web tyreLifetime rules)', () => {
  it('isStrongSerial matches the pinned web table', () => {
    for (const [v, want] of Object.entries(SERIAL_VECTORS)) expect(isStrongSerial(v)).toBe(want)
  })
  it('a refit of the same real serial adds no second purchase; a weak serial keeps its price', () => {
    const rows = [
      { serial_no: 'YMA55310', country: 'KSA', cost_per_tyre: 900, issue_date: '2025-01-01' },
      { serial_no: 'yma55310', country: 'KSA', cost_per_tyre: 900, issue_date: '2025-06-01' },
      { serial_no: 'DOT18E56', country: 'KSA', cost_per_tyre: 500, issue_date: '2025-06-01' },
      { serial_no: 'DOT18E56', country: 'KSA', cost_per_tyre: 500, issue_date: '2025-07-01' },
      { serial_no: 'YMA55310', country: 'UAE', cost_per_tyre: 700, issue_date: '2025-07-01' },
    ]
    expect(onePricePerTyre(rows)).toEqual([900, 0, 500, 500, 700])
  })
  it('never adds currencies together', () => {
    expect(singleCurrency([{ country: 'KSA' }, { country: 'UAE' }])).toBeNull()
    expect(singleCurrency([{ country: 'Egypt' }])).toBe('EGP')
    expect(moneyText(1234, null)).toBe('N/A (several currencies)')
  })
})
