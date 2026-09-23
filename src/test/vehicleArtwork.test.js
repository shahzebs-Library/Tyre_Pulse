import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  VEHICLE_MULTIVIEW_CATALOG,
  VEHICLE_VIEWS,
  VISUAL_KIND,
  artworkCatalogIdFor,
  artworkStemFor,
  assetClassOf,
  catalogStem,
  isTyrelessEquipment,
  normaliseText,
  searchableVehicleDescription,
  vehicleViewImage,
  vehicleViewImages,
  vehicleVisualKind,
} from '../lib/vehicleArtwork'

// The web must resolve the SAME board the Flutter app does, so these cases are
// written against the Dart resolver's branches, not against what looks tidy.

describe('vehicleArtwork helpers', () => {
  it('normaliseText folds separators, collapses runs and lowercases', () => {
    expect(normaliseText('TR-MIXER')).toBe('tr mixer')
    expect(normaliseText('  Double__Cab / 4x4 ')).toBe('double cab 4x4')
    expect(normaliseText(null)).toBe('')
    expect(normaliseText(undefined)).toBe('')
  })

  it('assetClassOf reads the leading letters and never invents one', () => {
    expect(assetClassOf('TM514')).toBe('TM')
    expect(assetClassOf(' mp093 ')).toBe('MP')
    expect(assetClassOf('9999')).toBeNull()
    expect(assetClassOf(null)).toBeNull()
  })

  it('isTyrelessEquipment matches the no-tyre keyword list as a substring', () => {
    expect(isTyrelessEquipment('BATCHING PLANT')).toBe(true)
    expect(isTyrelessEquipment('STATIONARY PUMP')).toBe(true)
    expect(isTyrelessEquipment('TR-MIXER')).toBe(false)
    expect(isTyrelessEquipment(null)).toBe(false)
  })

  it('searchableVehicleDescription joins type, make and model', () => {
    expect(
      searchableVehicleDescription({ vehicleType: 'PICKUP', make: 'Mitsubishi', model: 'L200' }),
    ).toBe('pickup mitsubishi l200')
  })
})

describe('artworkStemFor resolves the same board as the phone', () => {
  it('a transit mixer resolves the 3-axle mixer board', () => {
    expect(artworkCatalogIdFor({ assetNo: 'TM514', vehicleType: 'TR-MIXER' }))
      .toBe('transit-mixer-3axle')
    expect(artworkStemFor({ assetNo: 'TM514', vehicleType: 'TR-MIXER' }))
      .toBe('transit_mixer_3axle_five_view_v1')
    // The asset-number class alone is enough when the type says nothing.
    expect(artworkCatalogIdFor({ assetNo: 'TM662' })).toBe('transit-mixer-3axle')
  })

  it('a SANY 5-axle concrete pump resolves the SANY 5-axle board', () => {
    expect(
      artworkCatalogIdFor({
        assetNo: 'MP093',
        vehicleType: 'CONCRETE PUMP',
        make: 'SANY',
        model: '5 AXLE',
      }),
    ).toBe('sany-concrete-pump-5axle')
    // SANY named with no axle count still resolves: the make proves the body.
    expect(
      artworkCatalogIdFor({ assetNo: 'MP093', vehicleType: 'CONCRETE PUMP', make: 'SANY' }),
    ).toBe('sany-concrete-pump-5axle')
  })

  it('a 4-axle concrete pump resolves the white 4-axle board whatever the make', () => {
    expect(
      artworkCatalogIdFor({ assetNo: 'MP012', vehicleType: 'CONCRETE PUMP', model: '4 AXLE' }),
    ).toBe('white-concrete-pump-4axle')
    expect(
      artworkStemFor({ assetNo: 'MP012', vehicleType: 'BOOM PUMP 4AXLE' }),
    ).toBe('white_concrete_pump_4axle_five_view_v1')
  })

  it('a concrete pump with no provable axle count returns null', () => {
    // Two incompatible pump bodies exist. Inventing one would put damage marks
    // on axles the machine does not have, so the honest answer is no board.
    expect(artworkCatalogIdFor({ assetNo: 'MP001', vehicleType: 'CONCRETE PUMP' })).toBeNull()
    expect(artworkStemFor({ assetNo: 'MP001', vehicleType: 'CONCRETE PUMP' })).toBeNull()
    // A 5-axle pump that is NOT a SANY has no board either.
    expect(
      artworkCatalogIdFor({ vehicleType: 'CONCRETE PUMP 5 AXLE', make: 'PUTZMEISTER' }),
    ).toBeNull()
  })

  it('a bus resolves by brand, and an unbranded bus falls back to the generic board', () => {
    expect(artworkCatalogIdFor({ assetNo: 'BH021', vehicleType: 'BUS', make: 'ASHOK LEYLAND' }))
      .toBe('ashok-leyland-bus')
    expect(artworkCatalogIdFor({ vehicleType: 'STAFF BUS', make: 'TATA' })).toBe('tata-staff-bus')
    expect(artworkCatalogIdFor({ vehicleType: 'PICKUP', make: 'TOYOTA', model: 'HIACE' }))
      .toBe('toyota-hiace')
    expect(artworkCatalogIdFor({ assetNo: 'BH007', vehicleType: 'BUS' })).toBe('generic-staff-bus')
    expect(artworkCatalogIdFor({ vehicleType: 'BUS', make: 'N/A' })).toBe('generic-staff-bus')
    // A named brand we hold no board for gets none rather than another brand's bus.
    expect(artworkCatalogIdFor({ vehicleType: 'BUS', make: 'MERCEDES' })).toBeNull()
  })

  it('a Mitsubishi double cab resolves the Mitsubishi pickup board', () => {
    expect(
      artworkCatalogIdFor({ assetNo: 'PL077', vehicleType: 'PICKUP', make: 'MITSUBISHI', model: 'L200' }),
    ).toBe('mitsubishi-double-cab')
    expect(
      artworkStemFor({ vehicleType: 'DOUBLE CAB', make: 'MITSUBISHI' }),
    ).toBe('mitsubishi_double_cab_five_view_v1')
    // A pickup naming a brand with no board of its own returns null: the legacy
    // generic body cannot prove a make and must not pose as one.
    expect(artworkCatalogIdFor({ assetNo: 'PL090', vehicleType: 'PICKUP', make: 'NISSAN' })).toBeNull()
    expect(artworkCatalogIdFor({ assetNo: 'PL090', vehicleType: 'PICKUP' })).toBe('generic-double-cab')
  })

  it('a wheel loader that is not a SANY and not unbranded returns null', () => {
    expect(artworkCatalogIdFor({ assetNo: 'WL003', vehicleType: 'WHEEL LOADER', make: 'SANY' }))
      .toBe('sany-wheel-loader')
    // No make at all, or a make that only restates the class, keeps the board.
    expect(artworkCatalogIdFor({ assetNo: 'WL003', vehicleType: 'WHEEL LOADER' }))
      .toBe('sany-wheel-loader')
    expect(
      artworkCatalogIdFor({ vehicleType: 'WHEEL LOADER', make: 'WHEEL LOADER' }),
    ).toBe('sany-wheel-loader')
    // A different manufacturer must not borrow the SANY body.
    expect(
      artworkCatalogIdFor({ assetNo: 'WL004', vehicleType: 'WHEEL LOADER', make: 'KOMATSU' }),
    ).toBeNull()
    expect(
      artworkStemFor({ assetNo: 'WL004', vehicleType: 'WHEEL LOADER', make: 'KOMATSU' }),
    ).toBeNull()
  })

  it('unknown junk resolves to no board at all', () => {
    expect(artworkCatalogIdFor({ assetNo: 'ZZZ999', vehicleType: 'QWERTY ASDF' })).toBeNull()
    expect(artworkStemFor({ vehicleType: 'QWERTY ASDF' })).toBeNull()
    expect(artworkStemFor({})).toBeNull()
    expect(artworkStemFor()).toBeNull()
  })

  it('tyreless equipment resolves only when the identity is proven', () => {
    expect(artworkCatalogIdFor({ assetNo: 'GN103', vehicleType: 'GENERATOR', make: 'SANY' }))
      .toBe('sany-generator')
    expect(artworkCatalogIdFor({ assetNo: 'GN103', vehicleType: 'GENERATOR' })).toBeNull()
    expect(artworkCatalogIdFor({ vehicleType: 'CHILLER', make: 'SNOWKEY' })).toBe('snowkey-chiller')
    expect(artworkCatalogIdFor({ vehicleType: 'INDUSTRIAL WATER CHILLER', make: 'LG' }))
      .toBe('industrial-chiller')
    expect(artworkCatalogIdFor({ vehicleType: 'BATCHING PLANT', make: 'SANY' }))
      .toBe('sany-batching-plant')
    expect(artworkCatalogIdFor({ vehicleType: 'PLACING BOOM', make: 'HAMAC' })).toBe('placing-boom')
    expect(artworkCatalogIdFor({ vehicleType: 'STATIONARY PUMP', make: 'SANY' }))
      .toBe('sany-stationary-pump')
    expect(artworkCatalogIdFor({ vehicleType: 'TOWABLE PUMP', make: 'SANY' }))
      .toBe('sany-towable-pump')
    // An ice plant is real tyreless equipment with no board of its own.
    expect(artworkCatalogIdFor({ assetNo: 'IP065', vehicleType: 'ICE PLANT' })).toBeNull()
  })

  it('a line pump and a skid loader resolve their own boards', () => {
    expect(artworkCatalogIdFor({ assetNo: 'LP005', vehicleType: 'LINE PUMP' })).toBe('line-pump-4axle')
    expect(artworkCatalogIdFor({ assetNo: 'SL019', vehicleType: 'SKID LOADER', make: 'CAT' }))
      .toBe('cat-skid-loader')
    expect(artworkCatalogIdFor({ assetNo: 'SL019', vehicleType: 'SKID LOADER' })).toBeNull()
  })

  it('a trailer and a plain truck deliberately have no board', () => {
    expect(vehicleVisualKind({ vehicleType: 'TRAILER' })).toBe(VISUAL_KIND.trailer)
    expect(artworkCatalogIdFor({ vehicleType: 'TRAILER' })).toBeNull()
    expect(vehicleVisualKind({ vehicleType: 'WATER TANKER' })).toBe(VISUAL_KIND.genericRoadVehicle)
    expect(artworkCatalogIdFor({ vehicleType: 'WATER TANKER' })).toBeNull()
  })
})

describe('vehicleViewImage', () => {
  const mixer = { assetNo: 'TM514', vehicleType: 'TR-MIXER' }

  it('builds the per-view URL for an asset that has a board', () => {
    expect(vehicleViewImage(mixer, 'left'))
      .toBe('/vehicle-views/transit_mixer_3axle_five_view_v1_left.png')
    expect(vehicleViewImage(mixer, 'top'))
      .toBe('/vehicle-views/transit_mixer_3axle_five_view_v1_top.png')
  })

  it('returns null for an asset with no board and for an unknown view name', () => {
    expect(vehicleViewImage({ vehicleType: 'CONCRETE PUMP' }, 'front')).toBeNull()
    expect(vehicleViewImage(mixer, 'underside')).toBeNull()
    expect(vehicleViewImage(mixer, '')).toBeNull()
    expect(vehicleViewImage(mixer, undefined)).toBeNull()
  })

  it('vehicleViewImages returns all five views, or null', () => {
    const all = vehicleViewImages(mixer)
    expect(Object.keys(all)).toEqual(VEHICLE_VIEWS)
    expect(all.front).toBe('/vehicle-views/transit_mixer_3axle_five_view_v1_front.png')
    expect(vehicleViewImages({ vehicleType: 'TRAILER' })).toBeNull()
  })
})

describe('catalog and image files agree', () => {
  const viewsDir = path.resolve(__dirname, '..', '..', 'public', 'vehicle-views')

  it('every catalog stem has all five view files on disk', () => {
    const missing = []
    for (const [id, entry] of Object.entries(VEHICLE_MULTIVIEW_CATALOG)) {
      for (const view of VEHICLE_VIEWS) {
        const file = path.join(viewsDir, `${entry.stem}_${view}.png`)
        if (!existsSync(file)) missing.push(`${id}: ${entry.stem}_${view}.png`)
      }
    }
    expect(missing).toEqual([])
  })

  it('catalog stems are unique and catalogStem is null for an unknown id', () => {
    const stems = Object.values(VEHICLE_MULTIVIEW_CATALOG).map((e) => e.stem)
    expect(new Set(stems).size).toBe(stems.length)
    expect(catalogStem('no-such-board')).toBeNull()
    expect(catalogStem(null)).toBeNull()
  })
})
