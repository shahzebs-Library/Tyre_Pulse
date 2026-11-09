// Shared fixture for the Group D lifetime tests: ONE physical tyre (strong serial)
// fitted on three vehicles, a same-vehicle refit, and a second tyre.
export const SER = 'SER1234567'
export const OTHER = 'OTH9876543'
export const threeVehicles = () => ([
  { id: 'r1', serial_no: SER, country: 'KSA', asset_no: 'V1', site: 'NHC', brand: 'Alpha', size: '315/80R22.5', driver_name: 'Ali', status: 'Removed', issue_date: '2025-01-01', removal_date: '2025-03-01', cost_per_tyre: 1000, km_at_fitment: 10000, km_at_removal: 30000, risk_level: 'High', category: 'Normal' },
  { id: 'r2', serial_no: SER, country: 'KSA', asset_no: 'V2', site: 'NHC', brand: 'Alpha', size: '315/80R22.5', driver_name: 'Ali', status: 'Removed', issue_date: '2025-04-01', removal_date: '2025-06-01', cost_per_tyre: null, km_at_fitment: 50000, km_at_removal: 80000, risk_level: 'Low', category: 'Normal' },
  { id: 'r3', serial_no: SER, country: 'KSA', asset_no: 'V3', site: 'NHC', brand: 'Alpha', size: '315/80R22.5', driver_name: 'Ali', status: 'Removed', issue_date: '2025-07-01', removal_date: '2025-09-01', cost_per_tyre: null, km_at_fitment: 5000, km_at_removal: 15000, risk_level: 'Low', category: 'Normal' },
  { id: 'o1', serial_no: OTHER, country: 'KSA', asset_no: 'V1', site: 'JED', brand: 'Beta', size: '315/80R22.5', driver_name: 'Sara', status: 'Removed', issue_date: '2025-02-01', removal_date: '2025-08-01', cost_per_tyre: 2000, km_at_fitment: 20000, km_at_removal: 60000, risk_level: 'Low', category: 'Normal' },
])
// SER lifetime: price 1000 once, km 20000 + 30000 + 10000 = 60000 -> CPK 1000/60000
export const SER_CPK = 1000 / 60000
// OTHER: 2000 / 40000
export const OTHER_CPK = 2000 / 40000

/** The same tyre refitted on the SAME vehicle, the refit row carrying the price again. */
export const sameVehicleRefit = () => ([
  { id: 'a1', serial_no: SER, country: 'KSA', asset_no: 'V1', site: 'NHC', brand: 'Alpha', driver_name: 'Ali', status: 'Removed', issue_date: '2025-01-01', removal_date: '2025-03-01', cost_per_tyre: 1000, km_at_fitment: 10000, km_at_removal: 30000 },
  { id: 'a2', serial_no: SER, country: 'KSA', asset_no: 'V1', site: 'NHC', brand: 'Alpha', driver_name: 'Ali', status: 'Removed', issue_date: '2025-04-01', removal_date: '2025-06-01', cost_per_tyre: 1000, km_at_fitment: 40000, km_at_removal: 60000 },
])
// one price (1000), km 20000 + 20000 = 40000
export const REFIT_CPK = 1000 / 40000
