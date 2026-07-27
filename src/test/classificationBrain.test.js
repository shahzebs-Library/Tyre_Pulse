import { describe, it, expect } from 'vitest'
import {
  classifyLine, categoryFromCode, hasTyreSize, hasTyreBrand, isAccessory, isLubricant,
  summariseBuckets, explainDecision, CATEGORY_BUCKET,
} from '../lib/classificationBrain'

// Every case below is a REAL row from the live expense table. They are the cases that
// the old description-regex got wrong, which is why they are the test suite.

describe('the failures that motivated this engine', () => {
  it('does not call a part number a tyre size', () => {
    // These four all classified as TYRE before, because a digit run inside the part
    // number matched a size pattern. Together they were SAR 1.77M of spares in the
    // KSA tyre column.
    const cases = [
      { itemCode: '030043-O', description: 'PLATE KIT, PRESSURE , COMPLETE 3400121501 / 0222504801' },
      { itemCode: '400044-O', description: 'END HOSE 5.5 4MTR 1010095724 /101111567/ 98089983 RSP381' },
      { itemCode: '222333-O', description: 'GEARBOX SICOMA ITALY 3M MAO4500/3000 (861) (LEFT' },
      { itemCode: '400045-O', description: 'SPONGE BALL 6 DN150 10107018 /10107148/1010183215-6650007' },
    ]
    for (const c of cases) {
      expect(classifyLine(c).bucket, c.description).toBe('spare')
    }
  })

  it('catches the brake disc whose part number contained 705/054', () => {
    // This one survived an earlier regex "fix" because 705/054 inside
    // 500103705/05474876 looked like a tyre size. AED 83,473.
    const r = classifyLine({
      itemCode: '430631-O',
      description: 'BRAKE DISC COMPLETE BM62HF600NM400AC - 500103705/05474876',
    })
    expect(r.bucket).toBe('spare')
  })

  it('recognises compressor oil and engine oils the old patterns missed', () => {
    // COMPRESSOR OIL 68 was SAR 61,819 in spare. Egypt's engine oils were EGP 7.2M.
    for (const d of [
      'COMPRESSOR OIL 68',
      'MOBILE DELVAC OIL 15W40',
      'Shell Rimula R6L MCJ-4 10W-40 ( 5W-40)',
      'Shell RimR4X  15W-40 CI4E7DH1',
      'Fuchs 10w40',
      'Brake Oil Dot 4 250 ml',
      'Grease EP0 (180 Kg)',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('oil')
    }
  })

  it('books coolant as a fluid, the way all three countries already book it', () => {
    // Checked against every stored bucket: KSA 622 coolant lines, Egypt 113, UAE 9,
    // every one of them already in oil. Without these tokens the engine sent KSA's
    // to the spare default while Egypt's code range kept them in oil, so the engine
    // would have introduced an inconsistency the data does not have. 'COOLIANT' is
    // the Egypt export's own spelling.
    for (const d of [
      'Coolant 2056613 Cat',
      'COOLIANT  33% CONSENT.',
      'Fuchs COOLIANT  50%',
      'ANTIFREEZE CONCENTRATE 20L',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('oil')
    }
  })

  it('keeps a coolant PART in spare', () => {
    // The part tokens are tested before the fluid tokens, which is what separates
    // the fluid from the plumbing that carries it.
    for (const d of [
      'COOLANT FILTER (SHOVEL) OEM#:20532237',
      'COOLANT LINE  [O.E.] OEM#:5412003552',
      'COOLANT TANK CAP',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('spare')
    }
  })

  it('does not read a dimension string as a viscosity grade', () => {
    // Both of these were live: "6W 24" and "50 W 60" matched the viscosity
    // pattern and put 64 lines of bolts and lamps into the oil bucket.
    for (const d of [
      'REAR U BOLT 6W 24*92*500 (SANY MIXER',
      'LED LIGHT 50 W 60*60',
      'BRACKET 10W 20x30',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('spare')
    }
  })

  it('still reads a real viscosity grade, spaced or not', () => {
    for (const d of ['Fuchs 10w40', 'MOBILE DELVAC 15W40', 'Shell Spirax S2 A 85 W - 140']) {
      expect(classifyLine({ description: d }).bucket, d).toBe('oil')
    }
  })

  it('catches lubricating oil and diesel exhaust fluid', () => {
    // 'lubricant' is matched whole-word, so it never reached "LUBRICATING OIL".
    // AdBlue is a dosed consumable fluid the fleet already books as oil.
    for (const d of [
      'BITZER REFRIGERATION LUBRICATING OIL B320SH 20LTR',
      'ADBLUE (DIESEL EXHAUST FLUID',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('oil')
    }
  })

  it('still treats a part that merely mentions oil as a part', () => {
    for (const d of [
      'OIL FILTER OEM#:3526311-45001',
      'OIL SEAL 57.15-34.93-7.90',
      'OIL COOLER (REP.PART)',
      'OIL LINE OEM#:945.269.0834',
      'OIL INJECTION FILTER 29030036',
      'OIL BAFFLE 3892610665',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('spare')
    }
  })

  it('recognises tyre brands that carry no tyre word', () => {
    // These were the biggest genuine tyres my own scan first mislabelled as suspect.
    for (const d of [
      'ROADX CN 315/80 R22.5 20PR AP869 157/154K-TL',
      'LONGMARCH 315/80R22.5 20PR LM216',
      'ROCKHOLDER 385/65R22.5 24PR',
      'MAC ROYAL 12.00 R24 20PR',
      'ROADWEST 23.5-25',
      'V-GLORY 315/80 R22.5 20PR',
      'FORTUNE 245/70R16',
      'TAIHO E3/L3 23.5-25',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('tyre')
    }
  })
})

describe('the ERP code range, the strongest machine signal', () => {
  it('maps the ranges read off the live data', () => {
    expect(categoryFromCode('310681-O').category).toBe('tyre')
    expect(categoryFromCode('TI-GE-0044').category).toBe('tyre')
    expect(categoryFromCode('OL-GE-0004').category).toBe('lubricant')
    expect(categoryFromCode('150009-O').category).toBe('filter')
    expect(categoryFromCode('400045-O').category).toBe('spare_part')
    expect(categoryFromCode('430853-O').category).toBe('spare_part')
    expect(categoryFromCode('050109-O').category).toBe('spare_part')
    expect(categoryFromCode('420866-O').category).toBe('spare_part')
  })

  it('returns null outside every known range, rather than guessing', () => {
    expect(categoryFromCode('222678-O')).toBeNull()
    expect(categoryFromCode('')).toBeNull()
    expect(categoryFromCode(null)).toBeNull()
  })

  it('is case and whitespace insensitive, since the data has both', () => {
    // live data contains both 310522-O and 310522-o, and ol-ge-0004
    expect(categoryFromCode(' 310522-o ').category).toBe('tyre')
    expect(categoryFromCode('ol-ge-0004').category).toBe('lubricant')
  })
})

describe('accessories are never tyres', () => {
  it('keeps tyre consumables and wheel parts in spare', () => {
    for (const d of [
      'TYRE PATCHES NO 5', 'TUBELESS TYRE PUNCTURE', 'TYRE NOZZLE', 'TYRE REPAIR TOOL',
      'TIRE WELDING MACHINE', 'TIRE WHEEL BARROW', 'TYRE KILOMITTER',
      'WHEEL RIM 315/80R 22.5', 'INNER TUBE 23.5-25', 'FLAP 23.5-25',
      'TUBE AND FLAP 23.5-25', 'VALVE 315/80R22.5 TUBELESS', 'WHEEL BOLT LONG FEBI',
    ]) {
      expect(classifyLine({ description: d }).bucket, d).toBe('spare')
    }
  })

  it('a real tyre is not demoted just because its text contains an accessory word', () => {
    // "TIRE 10-16.5TL 12PR ATI1-11 (BOBCAT TIRE) HRI" - code range says tyre and a
    // size is present, so the accessory guard must not fire.
    const r = classifyLine({
      itemCode: '310504-O',
      description: 'TIRE 10-16.5TL 12PR ATI1-11 (BOBCAT TIRE) HRI',
    })
    expect(r.bucket).toBe('tyre')
  })
})

describe('the job card is corroboration, never an override', () => {
  it('does NOT turn a battery on a tyre job card into a tyre cost', () => {
    // Live data: tyre job cards carry BATTERY 200 AMP, GEAR BOX COMPLETE, ENGINE
    // CYLINDER, BRAKE PADS - about 601,916 across 550 codes. Treating the card as an
    // override would book all of that as tyre spend.
    for (const d of [
      'BATTERY200 AMP', 'GEAR BOX COMPLETE (USED) (ACT', 'Engine Cylinder KASRAWY BUS',
      'Arocs Front Brake Pads', 'DELIVERY CONCRETE HOSE 6M', 'MP3 FRONT GLASS',
    ]) {
      const r = classifyLine({ description: d }, { onTyreJobCard: true })
      expect(r.bucket, d).toBe('spare')
    }
  })

  it('promotes only an unidentified item that carries a tyre size', () => {
    const bare = { description: '315/80 R22.5 20PR' }
    expect(classifyLine(bare).bucket).toBe('spare')            // no evidence
    const r = classifyLine(bare, { onTyreJobCard: true })
    expect(r.bucket).toBe('tyre')
    expect(r.decidedBy).toBe('job-card')
  })

  it('does not promote an unidentified item with no tyre size', () => {
    const r = classifyLine({ description: 'BRACKET ASSEMBLY 12345' }, { onTyreJobCard: true })
    expect(r.bucket).toBe('spare')
  })
})

describe('a human decision wins over everything', () => {
  it('honours a reviewed category even against the code range', () => {
    // 450115-O is "COMPRESSOR OIL 68" but sits outside every code range; a reviewer
    // marked it a lubricant, and that must stand.
    const r = classifyLine(
      { itemCode: '310681-O', description: 'ROADX CN 315/80 R22.5' },
      { reviewedCategory: 'spare_part' },
    )
    expect(r.bucket).toBe('spare')
    expect(r.decidedBy).toBe('reviewed-master')
    expect(r.confidence).toBe(1)
  })

  it('ignores a reviewed category that is not a real category', () => {
    const r = classifyLine({ description: 'TIRE 315/80R22.5' }, { reviewedCategory: 'nonsense' })
    expect(r.bucket).toBe('tyre')
    expect(r.decidedBy).not.toBe('reviewed-master')
  })
})

describe('honest defaults and provenance', () => {
  it('defaults to spare with low confidence, never to nothing', () => {
    const r = classifyLine({ description: 'SOMETHING NOBODY LISTED' })
    expect(r.bucket).toBe('spare')
    expect(r.decidedBy).toBe('default')
    expect(r.confidence).toBeLessThan(0.5)
  })

  it('every category maps to a bucket, so cost can never vanish', () => {
    for (const [cat, bucket] of Object.entries(CATEGORY_BUCKET)) {
      expect(['tyre', 'spare', 'oil'], cat).toContain(bucket)
    }
  })

  it('always reports which evidence decided', () => {
    const r = classifyLine({ itemCode: '400045-O', description: 'SPONGE BALL' })
    expect(r.decidedBy).toBeTruthy()
    expect(r.reason).toBeTruthy()
    expect(explainDecision(r)).toMatch(/counts as spare/)
    expect(explainDecision(null)).toBe('')
  })

  it('handles empty input without throwing', () => {
    const r = classifyLine()
    expect(r.bucket).toBe('spare')
    expect(hasTyreSize(null)).toBe(false)
    expect(hasTyreBrand(undefined)).toBe(false)
    expect(isAccessory('')).toBe(false)
    expect(isLubricant(null)).toBe(false)
  })
})

describe('summariseBuckets never adds currencies together', () => {
  it('keeps each currency separate and flags a mixed set', () => {
    const s = summariseBuckets([
      { bucket: 'tyre', amount: 100, currency: 'SAR' },
      { bucket: 'spare', amount: 50, currency: 'SAR' },
      { bucket: 'oil', amount: 25, currency: 'AED' },
    ])
    expect(s.byCurrency.SAR).toEqual({ tyre: 100, spare: 50, oil: 0, total: 150 })
    expect(s.byCurrency.AED.oil).toBe(25)
    expect(s.mixed).toBe(true)
  })

  it('an unknown bucket still lands in spare so the total reconciles', () => {
    const s = summariseBuckets([{ bucket: 'weird', amount: 10, currency: 'SAR' }])
    expect(s.byCurrency.SAR.spare).toBe(10)
    expect(s.byCurrency.SAR.total).toBe(10)
  })

  it('tolerates junk input', () => {
    expect(summariseBuckets(null).mixed).toBe(false)
    expect(summariseBuckets([null]).byCurrency).toEqual({})
  })
})
