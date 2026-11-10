/**
 * tyreGolden.js - the GOLDEN tyre dataset.
 *
 * A small, fully hand-computed set of fitment rows (shape of tyre_records) that
 * covers every hard case the calculation engines must agree on. Every expected
 * figure below was worked out by hand from the business rules
 * (docs/tyre/BUSINESS_RULES.md), NOT copied from engine output, so a change to
 * an engine that moves one of these numbers is a change to a business rule and
 * must be argued, not re-baselined.
 *
 * Rules exercised:
 *   T1  one tyre, one price (first priced fitment, ties broken by id)
 *   T6  real serial vs weak serial (a weak serial is its own tyre, qty honoured)
 *   T7  km rule: placeholder fitment "1" = unknown, factory 0 = real, over class cap = unknown
 *   T8  life and CPK per PHYSICAL tyre, fleet CPK weighted (total cost / total km)
 *   T17 cost status ACTUAL | ESTIMATED | CONFIRMED_ZERO | DISPUTED | MISSING
 *   T18 an overlapping fitment adds no km and makes coverage partial
 *   T19 provisional (still fitted / incomplete km) vs final
 *   missing != zero: an unknown life or cost is null, never 0
 *
 * Every row is KSA (one currency). Class caps: TR-MIXER 80,000 km, PUMPS 56,000 km.
 */

const base = { country: 'KSA', qty: 1, vehicle_type: 'TR-MIXER', category: 'New' }
const row = (o) => ({ ...base, total_km: null, price_source: null, ...o })

export const GOLDEN_ROWS = [
  // G1 ROTATION - one tyre moved LHF1 -> RHF1 on the same vehicle.
  // life = (30000-10000) + (55000-30000) = 45,000 km; price 1000 counted once
  // (the refit row carries none); CPK = 1000 / 45000 = 0.0222222.
  row({ id: 'g1a', serial_no: 'ROT100001', asset_no: 'TM101', tyre_position: 'LHF1', brand: 'ALPHA', site: 'NHC',
    issue_date: '2025-01-10', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000, status: 'Removed' }),
  row({ id: 'g1b', serial_no: 'ROT100001', asset_no: 'TM101', tyre_position: 'RHF1', brand: 'ALPHA', site: 'NHC',
    issue_date: '2025-04-01', removal_date: '2025-08-01', km_at_fitment: 30000, km_at_removal: 55000, cost_per_tyre: null, status: 'Removed' }),

  // G2 TRANSFER - the same tyre moved to another vehicle at another site.
  // life = 20000 + 30000 = 50,000 km (each stint on its own vehicle's odometer);
  // CPK = 1200 / 50000 = 0.024. Attributed to its LATEST fitment: TM205 / JED.
  row({ id: 'g2a', serial_no: 'TRF200001', asset_no: 'TM102', tyre_position: 'LHR1', brand: 'BETA', site: 'NHC',
    issue_date: '2025-02-01', removal_date: '2025-05-01', km_at_fitment: 50000, km_at_removal: 70000, cost_per_tyre: 1200, status: 'Removed' }),
  row({ id: 'g2b', serial_no: 'TRF200001', asset_no: 'TM205', tyre_position: 'RHR1', brand: 'BETA', site: 'JED',
    issue_date: '2025-05-10', removal_date: '2025-09-01', km_at_fitment: 120000, km_at_removal: 150000, cost_per_tyre: null, status: 'Removed' }),

  // G3 MISSING SERIAL - cannot be tied to other rows, so it is its own tyre and its
  // quantity (2) is honoured: cost 800 x 2 = 1600, km 40000 x 2 = 80000 in the
  // weighted fleet figure; per-tyre CPK = 800 / 40000 = 0.02.
  row({ id: 'g3', serial_no: '', asset_no: 'TM103', tyre_position: 'LHR2', brand: 'ALPHA', site: 'NHC', qty: 2,
    issue_date: '2025-03-01', removal_date: '2025-07-01', km_at_fitment: 20000, km_at_removal: 60000, cost_per_tyre: 800, status: 'Removed' }),

  // G4 PLACEHOLDER KM - fitment odometer typed as 1, so total_km is the machine
  // odometer. Life UNKNOWN (null, not 229,999); no CPK. Priced 900, scrapped.
  row({ id: 'g4', serial_no: 'PLC400001', asset_no: 'TM104', tyre_position: 'LHF1', brand: 'ALPHA', site: 'JED',
    issue_date: '2025-01-15', removal_date: '2025-06-15', km_at_fitment: 1, km_at_removal: 230000, total_km: 229999, cost_per_tyre: 900, status: 'Scrapped' }),

  // G5a REVERSED DATES - removal date before fitment date, km valid. The km rule
  // reads the meters only: life = 65000 - 40000 = 25,000; CPK = 1100 / 25000 = 0.044.
  row({ id: 'g5a', serial_no: 'REV500001', asset_no: 'TM105', tyre_position: 'LHR1', brand: 'BETA', site: 'NHC',
    issue_date: '2025-06-01', removal_date: '2025-03-01', km_at_fitment: 40000, km_at_removal: 65000, cost_per_tyre: 1100, status: 'Removed' }),
  // G5b REVERSED KM - removal odometer below fitment, no total_km: life UNKNOWN.
  row({ id: 'g5b', serial_no: 'REV500002', asset_no: 'TM105', tyre_position: 'RHR1', brand: 'BETA', site: 'NHC',
    issue_date: '2025-02-01', removal_date: '2025-05-01', km_at_fitment: 65000, km_at_removal: 40000, cost_per_tyre: 1000, status: 'Removed' }),

  // G6 OVERLAPPING FITMENTS - a second entry for the same tyre starts while the
  // first is still on (double entry / unclosed rotation). Its km (10000) is NOT
  // added: life = 30,000 only, coverage partial, provisional. CPK = 1000 / 30000.
  row({ id: 'g6a', serial_no: 'OVL600001', asset_no: 'TM106', tyre_position: 'LHF1', brand: 'ALPHA', site: 'NHC',
    issue_date: '2025-01-01', removal_date: '2025-06-01', km_at_fitment: 10000, km_at_removal: 40000, cost_per_tyre: 1000, status: 'Removed' }),
  row({ id: 'g6b', serial_no: 'OVL600001', asset_no: 'TM106', tyre_position: 'LHF1', brand: 'ALPHA', site: 'NHC',
    issue_date: '2025-03-01', removal_date: '2025-05-01', km_at_fitment: 20000, km_at_removal: 30000, cost_per_tyre: null, status: 'Removed' }),

  // G7 DUPLICATE PURCHASE PRICE - one serial priced on two vehicles in the same
  // batch on the same day (the K507B403860 pattern). Listed MP111 first on purpose.
  // Same date -> the id decides: g7a (766) is the first priced fitment, g7b's 950
  // is dropped; status DISPUTED. g7b overlaps g7a (fitted before g7a ended), so
  // life = 65000 - 50000 = 15,000; CPK = 766 / 15000 = 0.0510667. Latest row (by
  // date then id) is g7b -> attributed to MP111 / JED. Both rows scrapped:
  // scrap cost = 766 ONCE.
  row({ id: 'g7b', serial_no: 'DUP700001', asset_no: 'MP111', vehicle_type: 'PUMPS', tyre_position: 'LHF1', brand: 'BETA', site: 'JED',
    issue_date: '2025-02-01', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 950, status: 'Scrapped' }),
  row({ id: 'g7a', serial_no: 'DUP700001', asset_no: 'TM676', tyre_position: 'RHF1', brand: 'BETA', site: 'NHC',
    issue_date: '2025-02-01', removal_date: '2025-05-01', km_at_fitment: 50000, km_at_removal: 65000, cost_per_tyre: 766, status: 'Scrapped' }),

  // G8 ESTIMATED PRICE - comparable-price backfill. Counted in CPK but reported
  // as the estimated share: 700 / 8366. life 40,000; CPK = 700 / 40000 = 0.0175.
  row({ id: 'g8', serial_no: 'EST800001', asset_no: 'TM108', tyre_position: 'LHR1', brand: 'GAMMA', site: 'NHC',
    issue_date: '2025-04-01', removal_date: '2025-09-01', km_at_fitment: 5000, km_at_removal: 45000, cost_per_tyre: 700, price_source: 'comparable', status: 'Removed' }),

  // G10 CONFIRMED ZERO COST - warranty replacement, evidenced. Status
  // CONFIRMED_ZERO, life 40,000 is real, but there is no purchase cost to divide,
  // so it stays OUT of every CPK (cost is not "0 measured", it is no purchase).
  row({ id: 'g10', serial_no: 'WAR900001', asset_no: 'TM109', tyre_position: 'RHR1', brand: 'GAMMA', site: 'NHC',
    issue_date: '2025-03-01', removal_date: '2025-08-01', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 0, price_source: 'warranty', status: 'Removed' }),

  // G11 OVER CLASS CAP - a mixer tyre "ran" 100,000 km (cap 80,000): a meter
  // error, life UNKNOWN, no CPK.
  row({ id: 'g11', serial_no: 'CAP110001', asset_no: 'TM110', tyre_position: 'LHF1', brand: 'GAMMA', site: 'NHC',
    issue_date: '2025-01-01', removal_date: '2025-10-01', km_at_fitment: 10000, km_at_removal: 110000, cost_per_tyre: 1000, status: 'Removed' }),

  // G12a PROVISIONAL - still fitted, no completed stint: life null, active.
  row({ id: 'g12a', serial_no: 'PRV120001', asset_no: 'TM112', tyre_position: 'LHR1', brand: 'ALPHA', site: 'NHC',
    issue_date: '2025-08-01', removal_date: null, km_at_fitment: 40000, km_at_removal: null, cost_per_tyre: 1300, status: 'Active' }),
  // G12b PROVISIONAL WITH HISTORY - factory-fitted (0 km) then refitted to
  // another vehicle where it still runs. Completed life so far = 20,000;
  // CPK so far = 1000 / 20000 = 0.05, provisional.
  row({ id: 'g12b1', serial_no: 'PRV120002', asset_no: 'TM113', tyre_position: 'LHF1', brand: 'BETA', site: 'NHC',
    issue_date: '2025-01-01', removal_date: '2025-05-01', km_at_fitment: 0, km_at_removal: 20000, cost_per_tyre: 1000, status: 'Removed' }),
  row({ id: 'g12b2', serial_no: 'PRV120002', asset_no: 'TM114', tyre_position: 'RHF1', brand: 'BETA', site: 'JED',
    issue_date: '2025-06-01', removal_date: null, km_at_fitment: 30000, km_at_removal: null, cost_per_tyre: null, status: 'Active' }),

  // G13 MISSING KM - removed with no meter reading at all: life null (not 0).
  row({ id: 'g13', serial_no: 'MSS130001', asset_no: 'TM115', tyre_position: 'RHR2', brand: 'GAMMA', site: 'NHC',
    issue_date: '2025-02-15', removal_date: '2025-07-15', km_at_fitment: null, km_at_removal: null, cost_per_tyre: 1000, status: 'Removed' }),
]

/** Per-row km by the shared rule (tyreKmAssessment status + km). */
export const GOLDEN_ROW_KM = {
  g1a: { status: 'measured', km: 20000 },
  g1b: { status: 'measured', km: 25000 },
  g2a: { status: 'measured', km: 20000 },
  g2b: { status: 'measured', km: 30000 },
  g3: { status: 'measured', km: 40000 },
  g4: { status: 'placeholder', km: null },
  g5a: { status: 'measured', km: 25000 },
  g5b: { status: 'missing', km: null },
  g6a: { status: 'measured', km: 30000 },
  g6b: { status: 'measured', km: 10000 },
  g7b: { status: 'measured', km: 20000 },
  g7a: { status: 'measured', km: 15000 },
  g8: { status: 'measured', km: 40000 },
  g10: { status: 'measured', km: 40000 },
  g11: { status: 'over_cap', km: null },
  g12a: { status: 'missing', km: null },
  g12b1: { status: 'factory', km: 20000 },
  g12b2: { status: 'missing', km: null },
  g13: { status: 'missing', km: null },
}

/**
 * One entry per PHYSICAL tyre (14). key = toLifetimeTyres()._key.
 * life/cost null = unknown. cpk = purchase lifetime CPK or null.
 */
export const GOLDEN_TYRES = {
  'KSA|ROT100001': { life: 45000, cost: 1000, qty: 1, status: 'ACTUAL', coverage: 'complete', provisional: false, active: false, fitments: 2, vehicles: 1, overlapping: 0, unknownKm: 0, cpk: 1000 / 45000, asset: 'TM101', site: 'NHC', brand: 'ALPHA' },
  'KSA|TRF200001': { life: 50000, cost: 1200, qty: 1, status: 'ACTUAL', coverage: 'complete', provisional: false, active: false, fitments: 2, vehicles: 2, overlapping: 0, unknownKm: 0, cpk: 0.024, asset: 'TM205', site: 'JED', brand: 'BETA' },
  'row:g3': { life: 40000, cost: 800, qty: 2, status: 'ACTUAL', coverage: 'complete', provisional: false, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 0, cpk: 0.02, asset: 'TM103', site: 'NHC', brand: 'ALPHA' },
  'KSA|PLC400001': { life: null, cost: 900, qty: 1, status: 'ACTUAL', coverage: 'none', provisional: true, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 1, cpk: null, asset: 'TM104', site: 'JED', brand: 'ALPHA' },
  'KSA|REV500001': { life: 25000, cost: 1100, qty: 1, status: 'ACTUAL', coverage: 'complete', provisional: false, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 0, cpk: 0.044, asset: 'TM105', site: 'NHC', brand: 'BETA' },
  'KSA|REV500002': { life: null, cost: 1000, qty: 1, status: 'ACTUAL', coverage: 'none', provisional: true, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 1, cpk: null, asset: 'TM105', site: 'NHC', brand: 'BETA' },
  'KSA|OVL600001': { life: 30000, cost: 1000, qty: 1, status: 'ACTUAL', coverage: 'partial', provisional: true, active: false, fitments: 2, vehicles: 1, overlapping: 1, unknownKm: 0, cpk: 1000 / 30000, asset: 'TM106', site: 'NHC', brand: 'ALPHA' },
  'KSA|DUP700001': { life: 15000, cost: 766, qty: 1, status: 'DISPUTED', coverage: 'partial', provisional: true, active: false, fitments: 2, vehicles: 2, overlapping: 1, unknownKm: 0, cpk: 766 / 15000, asset: 'MP111', site: 'JED', brand: 'BETA' },
  'KSA|EST800001': { life: 40000, cost: 700, qty: 1, status: 'ESTIMATED', coverage: 'complete', provisional: false, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 0, cpk: 0.0175, asset: 'TM108', site: 'NHC', brand: 'GAMMA' },
  'KSA|WAR900001': { life: 40000, cost: null, qty: 1, status: 'CONFIRMED_ZERO', coverage: 'complete', provisional: false, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 0, cpk: null, asset: 'TM109', site: 'NHC', brand: 'GAMMA' },
  'KSA|CAP110001': { life: null, cost: 1000, qty: 1, status: 'ACTUAL', coverage: 'none', provisional: true, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 1, cpk: null, asset: 'TM110', site: 'NHC', brand: 'GAMMA' },
  'KSA|PRV120001': { life: null, cost: 1300, qty: 1, status: 'ACTUAL', coverage: 'none', provisional: true, active: true, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 0, cpk: null, asset: 'TM112', site: 'NHC', brand: 'ALPHA' },
  'KSA|PRV120002': { life: 20000, cost: 1000, qty: 1, status: 'ACTUAL', coverage: 'complete', provisional: true, active: true, fitments: 2, vehicles: 2, overlapping: 0, unknownKm: 0, cpk: 0.05, asset: 'TM114', site: 'JED', brand: 'BETA' },
  'KSA|MSS130001': { life: null, cost: 1000, qty: 1, status: 'ACTUAL', coverage: 'none', provisional: true, active: false, fitments: 1, vehicles: 1, overlapping: 0, unknownKm: 1, cpk: null, asset: 'TM115', site: 'NHC', brand: 'GAMMA' },
}

/**
 * Fleet expectations, hand-computed.
 * Measurable tyres (price AND life): G1 1000/45000, G2 1200/50000, G3 1600/80000
 * (qty 2), G5a 1100/25000, G6 1000/30000, G7 766/15000, G8 700/40000, G12b 1000/20000.
 *   cost = 8366, km = 305,000 -> weighted fleet CPK = 8366 / 305000 = 0.0274295...
 * Tyres with a known life (avg life is per tyre, not qty-weighted): 45,50,40,25,30,15,40(G8),40(G10),20 thousand
 *   -> 305,000 / 9 = 33,888.9 km, median 40,000, min 15,000, max 50,000.
 * Purchase spend, each physical tyre once: 1000+1200+1600+900+1100+1000+1000+766+700+1000+1300+1000+1000 = 13,566
 *   (G10 confirmed zero contributes nothing).
 * Removal-rate stints (completed, measurable by the km rule, rem > fit): g1a g1b g2a g2b g3 g5a g6a g6b g7a g7b g8 g10 g12b1
 *   = 13 stints, 20+25+20+30+40+25+30+10+15+20+40+40+20 = 335,000 km -> 13 / 335 = 0.0388060 per 1000 km.
 *   (g4 placeholder and g11 over-cap are NOT distance.)
 * Scrap: G4 + G7 = 2 physical tyres of 14, cost 900 + 766 = 1666.
 */
export const GOLDEN_FLEET = {
  tyres: 14,
  fitmentRows: 19,
  measurable: 8,
  measurableQty: 9,
  cost: 8366,
  km: 305000,
  cpk: 8366 / 305000,
  estimatedCostInCpk: 700,
  estimatedShare: 700 / 8366,
  coverage: { complete: 7, partial: 2, none: 5 },
  costStatus: { ACTUAL: 11, ESTIMATED: 1, CONFIRMED_ZERO: 1, DISPUTED: 1, MISSING: 0 },
  provisional: 8,
  tyresWithOverlap: 2,
  refittedTyres: 5,
  life: { avg: 305000 / 9, median: 40000, min: 15000, max: 50000, count: 9 },
  purchaseSpend: 13566,
  removal: { stints: 13, km: 335000, per1000: (13 / 335000) * 1000 },
  scrap: { count: 2, total: 14, rows: 3, cost: 1666 },
}

/** Weighted CPK by the tyre's latest-fitment brand / site. */
export const GOLDEN_GROUPS = {
  brand: {
    ALPHA: { cost: 3600, km: 155000, validCount: 3, count: 4 }, // G1, G3 (qty 2), G6
    BETA: { cost: 4066, km: 110000, validCount: 4, count: 4 }, // G2, G5a, G7, G12b
    GAMMA: { cost: 700, km: 40000, validCount: 1, count: 1 }, // G8
  },
  site: {
    NHC: { cost: 5400, km: 220000 }, // G1, G3, G5a, G6, G8
    JED: { cost: 2966, km: 85000 }, // G2, G7, G12b
  },
  lifeByBrand: {
    ALPHA: (45000 + 40000 + 30000) / 3,
    BETA: (50000 + 25000 + 15000 + 20000) / 4,
    GAMMA: 40000, // G8 and G10 (G10 has a real life, just no purchase cost)
  },
  // Vendor scrap rate is per fitment EVENT: ALPHA 1 of 7 rows (g4), BETA 2 of 8 (g7a, g7b), GAMMA 0 of 4.
  vendorScrapRate: { ALPHA: 1 / 7, BETA: 2 / 8, GAMMA: 0 },
}

/**
 * Running & Remaining rows (shape of get_tyre_running_life) for the two tyres
 * still fitted, plus the placeholder case. The server measures the CURRENT stint
 * only: km_run = current odometer - fitment odometer.
 *   G12a: 70000 - 40000 = 30,000 of an 80,000 target -> 37.5% used -> healthy.
 *   G12b: 80000 - 30000 = 50,000 of 80,000 -> 62.5% used -> mid-life.
 *         Its lifetime km to date = 20,000 (completed factory stint) + 50,000 = 70,000.
 *   PLC (placeholder fitment km): the server returns no km run -> not measurable.
 */
export const GOLDEN_RUNNING_ROWS = [
  { serial_no: 'PRV120001', asset_no: 'TM112', position: 'LHR1', vehicle_type: 'TR-MIXER', unit: 'km', site: 'NHC', country: 'KSA', brand: 'ALPHA',
    fitted_on: '2025-08-01', km_at_fitment: 40000, current_km: 70000, km_run: 30000, expected_life_km: 80000, remaining_km: 50000, life_used_pct: 37.5, life_basis: 'manual' },
  { serial_no: 'PRV120002', asset_no: 'TM114', position: 'RHF1', vehicle_type: 'TR-MIXER', unit: 'km', site: 'JED', country: 'KSA', brand: 'BETA',
    fitted_on: '2025-06-01', km_at_fitment: 30000, current_km: 80000, km_run: 50000, expected_life_km: 80000, remaining_km: 30000, life_used_pct: 62.5, life_basis: 'manual' },
  { serial_no: 'PLC999999', asset_no: 'TM199', position: 'LHF1', vehicle_type: 'TR-MIXER', unit: 'km', site: 'NHC', country: 'KSA', brand: 'ALPHA',
    fitted_on: '2025-09-01', km_at_fitment: 1, current_km: 250000, km_run: null, expected_life_km: 80000, remaining_km: null, life_used_pct: null, life_basis: 'manual' },
]

export const GOLDEN_RUNNING = {
  PRV120001: { kmRun: 30000, band: 'healthy', lifeToDate: 30000 },
  PRV120002: { kmRun: 50000, band: 'mid-life', lifeToDate: 70000 },
  PLC999999: { kmRun: null, band: 'unknown', lifeToDate: null },
}
