// tyreSpecCatalog.js
// Single source of truth for tyre-specification vocabulary and industry-standard
// fitment defaults across Tyre Pulse. Covers on-road commercial vehicles plus
// off-road / OTR construction equipment (concrete pumps, wheel loaders, graders,
// dump trucks, forklifts, reach stackers). Chinese tyre brands (Double Coin and
// peers) are the primary approved brands; premium references are retained.
//
// Pure module: no React, no app imports. Plain exported consts + pure helpers.
// ASCII-only strings (hyphen "-", "to", "|", ":"). Values are engineering-credible.

// -- Vehicle types (on-road + off-road union) -------------------------------------
export const VEHICLE_TYPES = [
  // On-road commercial
  'Rigid Truck',
  'Mixer',
  'Tipper',
  'Semi-Trailer',
  'Tanker',
  'Flat Bed',
  'Bus',
  'Pickup',
  'Trailer',
  // Concrete pumping
  'Concrete Pump',
  'Boom Pump Truck',
  // OTR / construction
  'Wheel Loader',
  'Motor Grader',
  'Excavator',
  'Bulldozer',
  'Backhoe Loader',
  'Forklift',
  'Reach Stacker',
  'Rigid Dump Truck',
  'Mobile Crane',
  'Other',
]

// -- Fitment positions (on-road axles + OTR positions) ----------------------------
export const POSITIONS = [
  'Steer',
  'Drive',
  'Trailer',
  'Lift Axle',
  'Tag Axle',
  'Front (OTR)',
  'Rear (OTR)',
  'All Positions',
]

// -- Speed indices ----------------------------------------------------------------
export const SPEED_INDICES = ['J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'H', 'V', 'W', 'Y']

// ISO speed-symbol to rated km/h.
export const SPEED_INDEX_KMH = {
  G: 90,
  J: 100,
  K: 110,
  L: 120,
  M: 130,
  N: 140,
  P: 150,
  Q: 160,
  R: 170,
  S: 180,
  T: 190,
  U: 200,
  H: 210,
  V: 240,
  W: 270,
  Y: 300,
}

// Return the rated km/h for a speed-symbol letter, or null if unknown.
export function speedIndexKmh(letter) {
  if (letter == null) return null
  const key = String(letter).trim().toUpperCase()
  const v = SPEED_INDEX_KMH[key]
  return typeof v === 'number' ? v : null
}

// -- Load indices (ISO load-index to kg, truck / OTR range) -----------------------
export const LOAD_INDEX_KG = {
  120: 1400,
  121: 1450,
  122: 1500,
  123: 1550,
  124: 1600,
  125: 1650,
  126: 1700,
  127: 1750,
  128: 1800,
  129: 1850,
  130: 1900,
  131: 1950,
  132: 2000,
  133: 2060,
  134: 2120,
  135: 2180,
  136: 2240,
  137: 2300,
  138: 2360,
  139: 2430,
  140: 2500,
  141: 2575,
  142: 2650,
  143: 2725,
  144: 2800,
  145: 2900,
  146: 3000,
  147: 3075,
  148: 3150,
  149: 3250,
  150: 3350,
  151: 3450,
  152: 3550,
  153: 3650,
  154: 3750,
  155: 3875,
  156: 4000,
  157: 4125,
  158: 4250,
  159: 4375,
  160: 4500,
  161: 4625,
  162: 4750,
  163: 4875,
  164: 5000,
  165: 5150,
  166: 5300,
  167: 5450,
  168: 5600,
  169: 5800,
  170: 6000,
  171: 6150,
  172: 6300,
  173: 6500,
  174: 6700,
  175: 6900,
  176: 7100,
  177: 7300,
  178: 7500,
  179: 7750,
  180: 8000,
}

// Return the load-capacity in kg for a load-index number, or null if unknown.
export function loadIndexKg(n) {
  if (n == null) return null
  const key = Number(n)
  if (!Number.isFinite(key)) return null
  const v = LOAD_INDEX_KG[key]
  return typeof v === 'number' ? v : null
}

// -- Ply ratings ------------------------------------------------------------------
// Numeric ply-rating codes plus OTR star ratings ("*" light, "**" standard, "***" heavy).
export const PLY_RATINGS = [
  '6PR', '8PR', '10PR', '12PR', '14PR', '16PR', '18PR', '20PR', '24PR', '28PR', '32PR',
  '*', '**', '***',
]

// -- Approved brands --------------------------------------------------------------
// Chinese brands first (primary approved), then premium reference brands.
export const CHINESE_BRANDS = [
  'Double Coin',
  'Triangle',
  'Aeolus',
  'Linglong',
  'Sailun',
  'Goodride',
  'Westlake',
  'Wanli',
  'Annaite',
  'Fullrun',
  'Techking',
  'Advance',
]

export const REFERENCE_BRANDS = [
  'BKT',
  'Michelin',
  'Bridgestone',
  'Continental',
  'Goodyear',
]

export const APPROVED_BRANDS = [...CHINESE_BRANDS, ...REFERENCE_BRANDS]

// -- Smart defaults (industry-standard fitment profiles) --------------------------
// Shape: { vehicle_type, position, approved_sizes[], approved_brands[],
//          min_load_index, min_speed_index, ply_rating, recommended_pressure,
//          min_tread_depth, notes }
export const SMART_DEFAULTS = [
  // Rigid Truck
  {
    vehicle_type: 'Rigid Truck',
    position: 'Steer',
    approved_sizes: ['315/80R22.5', '295/80R22.5', '11R22.5'],
    approved_brands: ['Double Coin', 'Triangle', 'Aeolus', 'Michelin'],
    min_load_index: 154,
    min_speed_index: 'M',
    ply_rating: '18PR',
    recommended_pressure: 120,
    min_tread_depth: 3,
    notes: 'Double Coin RR905 steer pattern, long-haul rib for rigid trucks',
  },
  {
    vehicle_type: 'Rigid Truck',
    position: 'Drive',
    approved_sizes: ['315/80R22.5', '12R22.5', '11R22.5'],
    approved_brands: ['Double Coin', 'Linglong', 'Sailun', 'Goodyear'],
    min_load_index: 156,
    min_speed_index: 'L',
    ply_rating: '18PR',
    recommended_pressure: 110,
    min_tread_depth: 3,
    notes: 'Double Coin RLB490 drive pattern, deep traction dual fitment',
  },
  // Semi-Trailer
  {
    vehicle_type: 'Semi-Trailer',
    position: 'Trailer',
    approved_sizes: ['385/65R22.5', '445/65R22.5'],
    approved_brands: ['Double Coin', 'Aeolus', 'Triangle', 'Continental'],
    min_load_index: 160,
    min_speed_index: 'K',
    ply_rating: '20PR',
    recommended_pressure: 100,
    min_tread_depth: 2,
    notes: 'Double Coin FT111 wide-base trailer rib, monitor for irregular wear',
  },
  // Mixer
  {
    vehicle_type: 'Mixer',
    position: 'Steer',
    approved_sizes: ['315/80R22.5', '295/80R22.5', '13R22.5'],
    approved_brands: ['Double Coin', 'Triangle', 'Westlake', 'Bridgestone'],
    min_load_index: 156,
    min_speed_index: 'M',
    ply_rating: '18PR',
    recommended_pressure: 115,
    min_tread_depth: 3,
    notes: 'Double Coin RR905 on-off steer, higher payload consideration for mixers',
  },
  {
    vehicle_type: 'Mixer',
    position: 'Drive',
    approved_sizes: ['315/80R22.5', '13R22.5', '12R22.5'],
    approved_brands: ['Double Coin', 'Linglong', 'Goodride', 'Michelin'],
    min_load_index: 158,
    min_speed_index: 'K',
    ply_rating: '20PR',
    recommended_pressure: 115,
    min_tread_depth: 4,
    notes: 'Double Coin RLB1 on-off drive, cut resistant for site access',
  },
  // Tipper
  {
    vehicle_type: 'Tipper',
    position: 'Drive',
    approved_sizes: ['315/80R22.5', '13R22.5', '12.00R24'],
    approved_brands: ['Double Coin', 'Triangle', 'BKT', 'Goodyear'],
    min_load_index: 158,
    min_speed_index: 'L',
    ply_rating: '20PR',
    recommended_pressure: 110,
    min_tread_depth: 4,
    notes: 'Double Coin RLB1 aggressive on-off drive for tipper site work',
  },
  // Bus
  {
    vehicle_type: 'Bus',
    position: 'Steer',
    approved_sizes: ['295/80R22.5', '275/70R22.5'],
    approved_brands: ['Double Coin', 'Aeolus', 'Continental', 'Michelin'],
    min_load_index: 152,
    min_speed_index: 'N',
    ply_rating: '16PR',
    recommended_pressure: 110,
    min_tread_depth: 3,
    notes: 'Double Coin RR680 coach rib, wet grip and comfort priority',
  },
  // Concrete Pump (truck-mounted static outrigger unit)
  {
    vehicle_type: 'Concrete Pump',
    position: 'Steer',
    approved_sizes: ['385/65R22.5', '315/80R22.5'],
    approved_brands: ['Double Coin', 'Triangle', 'Aeolus', 'Michelin'],
    min_load_index: 158,
    min_speed_index: 'K',
    ply_rating: '20PR',
    recommended_pressure: 130,
    min_tread_depth: 3,
    notes: 'Double Coin FR605 heavy front rib, high static outrigger load carriage',
  },
  {
    vehicle_type: 'Concrete Pump',
    position: 'Drive',
    approved_sizes: ['315/80R22.5', '13R22.5'],
    approved_brands: ['Double Coin', 'Linglong', 'Sailun', 'Bridgestone'],
    min_load_index: 158,
    min_speed_index: 'K',
    ply_rating: '20PR',
    recommended_pressure: 120,
    min_tread_depth: 4,
    notes: 'Double Coin RLB1 support-axle drive, stable footprint under pump load',
  },
  // Boom Pump Truck (chassis-mounted boom pump)
  {
    vehicle_type: 'Boom Pump Truck',
    position: 'Steer',
    approved_sizes: ['385/65R22.5', '385/55R22.5'],
    approved_brands: ['Double Coin', 'Aeolus', 'Triangle', 'Continental'],
    min_load_index: 160,
    min_speed_index: 'K',
    ply_rating: '20PR',
    recommended_pressure: 130,
    min_tread_depth: 3,
    notes: 'Double Coin FR605 wide front steer, heavy multi-axle boom-truck front load',
  },
  {
    vehicle_type: 'Boom Pump Truck',
    position: 'Drive',
    approved_sizes: ['315/80R22.5', '13R22.5'],
    approved_brands: ['Double Coin', 'Linglong', 'Westlake', 'Michelin'],
    min_load_index: 158,
    min_speed_index: 'K',
    ply_rating: '20PR',
    recommended_pressure: 120,
    min_tread_depth: 4,
    notes: 'Double Coin RLB1 drive, on-off traction for congested pour sites',
  },
  // Wheel Loader (OTR, L-3 / L-5 patterns)
  {
    vehicle_type: 'Wheel Loader',
    position: 'Front (OTR)',
    approved_sizes: ['20.5-25', '23.5-25', '26.5-25', '20.5R25', '23.5R25'],
    approved_brands: ['Double Coin', 'Triangle', 'Techking', 'Advance'],
    min_load_index: 0,
    min_speed_index: 'K',
    ply_rating: '**',
    recommended_pressure: 45,
    min_tread_depth: 25,
    notes: 'Double Coin REM-2 L-3 loader pattern, cut and heat resistant for site work',
  },
  {
    vehicle_type: 'Wheel Loader',
    position: 'Rear (OTR)',
    approved_sizes: ['20.5-25', '23.5-25', '26.5-25', '23.5R25', '26.5R25'],
    approved_brands: ['Double Coin', 'Triangle', 'Techking', 'Advance'],
    min_load_index: 0,
    min_speed_index: 'K',
    ply_rating: '***',
    recommended_pressure: 45,
    min_tread_depth: 20,
    notes: 'Double Coin REM-8 L-5 deep-tread loader, rock and abrasion resistant',
  },
  // Motor Grader
  {
    vehicle_type: 'Motor Grader',
    position: 'All Positions',
    approved_sizes: ['14.00-24', '17.5-25', '13.00-24'],
    approved_brands: ['Double Coin', 'Triangle', 'Techking', 'Advance'],
    min_load_index: 0,
    min_speed_index: 'K',
    ply_rating: '16PR',
    recommended_pressure: 40,
    min_tread_depth: 18,
    notes: 'Double Coin G-2 grader pattern, all-position self-cleaning tread',
  },
  // Rigid Dump Truck (OTR E-3 / E-4)
  {
    vehicle_type: 'Rigid Dump Truck',
    position: 'Front (OTR)',
    approved_sizes: ['18.00-25', '21.00-35', '24.00-35'],
    approved_brands: ['Double Coin', 'Triangle', 'Techking', 'Advance'],
    min_load_index: 0,
    min_speed_index: 'K',
    ply_rating: '***',
    recommended_pressure: 65,
    min_tread_depth: 25,
    notes: 'Double Coin REM-14 E-4 haul pattern, heat and cut resistant for haul roads',
  },
  // Forklift (industrial pneumatic)
  {
    vehicle_type: 'Forklift',
    position: 'All Positions',
    approved_sizes: ['8.25-15', '7.00-12', '300-15', '28x9-15'],
    approved_brands: ['Double Coin', 'Advance', 'Westlake', 'BKT'],
    min_load_index: 0,
    min_speed_index: 'K',
    ply_rating: '14PR',
    recommended_pressure: 90,
    min_tread_depth: 10,
    notes: 'Double Coin industrial forklift pneumatic, high-load yard duty',
  },
  // Reach Stacker (container handler)
  {
    vehicle_type: 'Reach Stacker',
    position: 'All Positions',
    approved_sizes: ['18.00-25', '18.00-33'],
    approved_brands: ['Double Coin', 'Triangle', 'Techking', 'Advance'],
    min_load_index: 0,
    min_speed_index: 'K',
    ply_rating: '***',
    recommended_pressure: 100,
    min_tread_depth: 20,
    notes: 'Double Coin REM-14 port handler, high-load container reach-stacker duty',
  },
]

// -- Helpers ----------------------------------------------------------------------

// Return the smart-default profiles for a vehicle type (empty array if none).
export function defaultsForVehicleType(type) {
  if (type == null) return []
  const key = String(type).trim().toLowerCase()
  return SMART_DEFAULTS.filter((d) => d.vehicle_type.toLowerCase() === key)
}
