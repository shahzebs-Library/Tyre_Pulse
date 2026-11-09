// Shared fixture for the *.lifetime.test.js files (not a test file itself).
export const fit = (o) => ({ country: 'KSA', vehicle_type: 'TRUCK', qty: 1, status: 'Removed', ...o })

// One tyre fitted on three vehicles: price 900 once, km 40k + 25k + 15k = 80k.
export const MOVED = [
  fit({ id: 'a1', serial_no: 'YMA55310', brand: 'A', site: 'NHC', category: 'Wear', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 900, risk_level: 'High' }),
  fit({ id: 'a2', serial_no: 'YMA55310', brand: 'A', site: 'NHC', category: 'Wear', asset_no: 'TM2', issue_date: '2025-05-01', removal_date: '2025-08-01', km_at_fitment: 200000, km_at_removal: 225000, risk_level: 'Low' }),
  fit({ id: 'a3', serial_no: 'YMA55310', brand: 'A', site: 'NHC', category: 'Wear', asset_no: 'TM3', issue_date: '2025-09-01', removal_date: '2025-12-01', km_at_fitment: 5000, km_at_removal: 20000, risk_level: 'Low' }),
]
// One tyre refitted on the same vehicle; the ERP priced the refit again.
export const REFIT = [
  fit({ id: 'b1', serial_no: 'EP0604207', brand: 'B', site: 'JED', category: 'Wear', asset_no: 'TM9', issue_date: '2025-01-10', removal_date: '2025-03-01', km_at_fitment: 1000, km_at_removal: 21000, cost_per_tyre: 800, risk_level: 'Low' }),
  fit({ id: 'b2', serial_no: 'EP0604207', brand: 'B', site: 'JED', category: 'Wear', asset_no: 'TM9', issue_date: '2025-06-10', removal_date: '2025-09-01', km_at_fitment: 40000, km_at_removal: 60000, cost_per_tyre: 800, risk_level: 'High' }),
]
