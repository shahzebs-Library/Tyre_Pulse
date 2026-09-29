import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TREAD_CLASSES, normalizeSize, parseTyreSize, sizeClass, positionRole,
  catalogueTreadClass, matchCatalogue, resolveTyreImage, tyreImageCaption,
} from '../lib/tyreImage'

describe('tyreImage', () => {
  it('ships an image file for every tread class', () => {
    for (const key of Object.keys(TREAD_CLASSES)) {
      expect(existsSync(resolve(__dirname, `../../public/tyre-images/${key}.svg`))).toBe(true)
    }
  })

  it('folds size spelling', () => {
    expect(normalizeSize(' 315/80 R 22.5 ')).toBe('315/80R22.5')
    expect(parseTyreSize('315 /80R22.5')).toMatchObject({ width: 315, aspect: 80, rim: 22.5 })
    expect(parseTyreSize('ITEM/TYRE')).toBeNull()
  })

  it('classifies the sizes this fleet actually carries', () => {
    expect(sizeClass('315/80 R 22.5')).toBe('truck')
    expect(sizeClass('385/65 R 22.5')).toBe('truck')
    expect(sizeClass('11 R 22.5')).toBe('truck')
    expect(sizeClass('23.5 R 25')).toBe('otr')
    expect(sizeClass('10-16.5/10')).toBe('industrial')
    expect(sizeClass('235/75 R 17.5')).toBe('lightTruck')
    expect(sizeClass('195 R 15')).toBe('lightTruck')
    expect(sizeClass('700 R 16')).toBe('lightTruck')
    expect(sizeClass('265/70R16')).toBe('lightTruck')
    expect(sizeClass('225/45R17')).toBe('passenger')
    expect(sizeClass('')).toBeNull()
  })

  it('reads the axle role from the wheel position code', () => {
    expect(positionRole('LHF1')).toBe('steer')
    expect(positionRole('RHF2')).toBe('steer')
    expect(positionRole('LHRO')).toBe('drive')
    expect(positionRole('RHCI')).toBe('drive')
    expect(positionRole('LHT1')).toBe('trailer')
    expect(positionRole('SPARE')).toBeNull()
    expect(positionRole(null)).toBeNull()
  })

  it('uses size and position for a truck tyre', () => {
    expect(resolveTyreImage({ size: '315/80 R 22.5', position: 'LHF1' })).toMatchObject({ key: 'steer', basis: 'position' })
    expect(resolveTyreImage({ size: '315/80 R 22.5', position: 'RHRI' })).toMatchObject({ key: 'drive', basis: 'position' })
    expect(resolveTyreImage({ size: '315/80 R 22.5' })).toMatchObject({ key: 'allPosition', basis: 'size' })
    expect(resolveTyreImage({ size: '385/65 R 22.5' })).toMatchObject({ key: 'wideSingle', basis: 'size' })
    expect(resolveTyreImage({ size: '23.5 R 25', position: 'LHF1' }).key).toBe('otrL3')
  })

  it('falls back to a neutral tyre and never names a brand', () => {
    const img = resolveTyreImage({ size: null })
    expect(img).toMatchObject({ key: 'neutral', basis: 'none', pattern: null })
    expect(img.src).toBe('/tyre-images/neutral.svg')
    expect(tyreImageCaption(img)).toMatch(/Neutral illustration/)
  })

  it('prefers the catalogue when it names the tread type', () => {
    const cat = [
      { brand: 'Triangle', size: '315/80 R22.5', pattern: 'TR697', tyre_type: 'Drive', approval_status: 'pending' },
      { brand: 'TRIANGLE', size: '315/80R22.5', pattern: 'TRS02', tyre_type: 'Steer', approval_status: 'approved' },
    ]
    const hit = matchCatalogue(cat, { brand: 'triangle ', size: '315/80 R 22.5' })
    expect(hit.pattern).toBe('TRS02')
    const img = resolveTyreImage({ size: '315/80 R 22.5', position: 'RHRO', catalogue: hit })
    expect(img).toMatchObject({ key: 'steer', basis: 'catalogue', pattern: 'TRS02' })
    expect(tyreImageCaption(img)).toContain('TRS02')
    expect(matchCatalogue(cat, { brand: 'ROADX', size: '315/80R22.5' })).toBeNull()
    expect(catalogueTreadClass({ application: 'Wheel loader L5' })).toBe('otrL5')
    expect(catalogueTreadClass({ tyre_type: 'All position' })).toBe('allPosition')
    expect(catalogueTreadClass({})).toBeNull()
  })
})
