// Shared fixtures for the Group B lifetime tests (one physical tyre, many fitments).
export const fit = (o) => ({ country: 'KSA', vehicle_type: 'TRUCK', qty: 1, status: 'Removed', ...o })

/** One tyre (YMA55310) on three vehicles: price 900 once, km 40,000 + 25,000 + 15,000 = 80,000. */
export const threeVehicles = (extra = {}) => [
  fit({ id: 'a', serial_no: 'YMA55310', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 900, ...extra }),
  fit({ id: 'b', serial_no: 'YMA55310', asset_no: 'TM2', issue_date: '2025-05-01', removal_date: '2025-08-01', km_at_fitment: 200000, km_at_removal: 225000, cost_per_tyre: 900, ...extra }),
  fit({ id: 'c', serial_no: 'YMA55310', asset_no: 'TM3', issue_date: '2025-09-01', removal_date: '2025-12-01', km_at_fitment: 5000, km_at_removal: 20000, ...extra }),
]

/** One tyre (EP0604207) refitted on the SAME vehicle, priced on both rows. */
export const refitSameVehicle = (extra = {}) => [
  fit({ id: 'r1', serial_no: 'EP0604207', asset_no: 'TM9', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 1000, km_at_removal: 21000, cost_per_tyre: 800, ...extra }),
  fit({ id: 'r2', serial_no: 'EP0604207', asset_no: 'TM9', issue_date: '2025-06-01', removal_date: '2025-09-01', km_at_fitment: 40000, km_at_removal: 60000, cost_per_tyre: 800, ...extra }),
]
