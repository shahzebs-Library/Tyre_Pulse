/**
 * Tyre programme ROI model — pure, currency-agnostic (ported from tyre_saas's
 * ROI calculator). Given fleet + performance inputs, projects the annual savings
 * from a proactive tyre-management programme (life extension, retread, downtime
 * reduction, emergency-premium avoidance, compliance-fine avoidance, fuel), the
 * programme cost, net benefit, ROI %, and payback months. Callers format money
 * with the active currency; nothing here assumes a currency.
 */

export const ROI_DEFAULTS = {
  fleet_size: 50,
  avg_tyres_per_vehicle: 6,
  avg_tyre_cost: 1400,
  avg_tyre_life_km: 90000,
  daily_km_per_vehicle: 200,
  current_cpkm: 0.04,
  downtime_incidents_per_year: 12,
  downtime_cost_per_incident: 3500,
  retread_adoption_pct: 0,
  programme_cost_per_tyre_month: 35,
  fuel_cost_per_vehicle_year: 50000,
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {object} rawInputs  partial overrides of ROI_DEFAULTS
 * @returns {object} results incl. breakdown[] and 3-year projection[]
 */
export function computeTyreRoi(rawInputs = {}) {
  const f = {}
  for (const k of Object.keys(ROI_DEFAULTS)) f[k] = num(rawInputs[k] ?? ROI_DEFAULTS[k])

  const totalTyres = f.fleet_size * f.avg_tyres_per_vehicle
  const annualKmPerVehicle = f.daily_km_per_vehicle * 365
  const tyreReplacementsPerYear = f.avg_tyre_life_km > 0
    ? (f.fleet_size * annualKmPerVehicle) / f.avg_tyre_life_km : 0
  const currentAnnualTyreCost = tyreReplacementsPerYear * f.avg_tyre_cost
  const currentDowntimeCost = f.downtime_incidents_per_year * f.downtime_cost_per_incident

  // Savings model (same coefficients as the source):
  const lifeExtensionSavings = currentAnnualTyreCost * 0.15          // +15% tyre life via preventive maintenance
  const retreadSavings = totalTyres * (f.retread_adoption_pct / 100) * f.avg_tyre_cost * 0.45
  const downtimeReduction = currentDowntimeCost * 0.40               // 40% fewer incidents via predictive alerts
  const emergencyPremiumSavings = currentAnnualTyreCost * 0.08       // avoid emergency-purchase premium
  const complianceFineAvoidance = totalTyres * 0.05 * 750           // ~5% at risk, avg fine 750
  const fuelSavings = f.fleet_size * f.fuel_cost_per_vehicle_year * 0.02 // 2% fuel from optimal pressure

  const totalAnnualSavings = lifeExtensionSavings + retreadSavings + downtimeReduction
    + emergencyPremiumSavings + complianceFineAvoidance + fuelSavings

  const programmeAnnualCost = totalTyres * f.programme_cost_per_tyre_month * 12
  const netSavings = totalAnnualSavings - programmeAnnualCost
  const roi = programmeAnnualCost > 0 ? (netSavings / programmeAnnualCost) * 100 : 0
  const paybackMonths = netSavings > 0 && totalAnnualSavings > 0
    ? (programmeAnnualCost / totalAnnualSavings) * 12 : null
  const improvedCpkm = Math.max(0.02, f.current_cpkm * 0.82)

  const round = (n) => Math.round(n)
  return {
    totalTyres,
    currentAnnualTyreCost: round(currentAnnualTyreCost),
    currentDowntimeCost: round(currentDowntimeCost),
    programmeAnnualCost: round(programmeAnnualCost),
    totalAnnualSavings: round(totalAnnualSavings),
    netAnnualBenefit: round(netSavings),
    roi: round(roi),
    paybackMonths: paybackMonths == null ? null : Math.round(paybackMonths),
    improvedCpkm: Number(improvedCpkm.toFixed(4)),
    cpkmImprovementPct: f.current_cpkm > 0 ? Math.round((1 - improvedCpkm / f.current_cpkm) * 100) : 0,
    breakdown: [
      { name: 'Tyre life extension', value: round(lifeExtensionSavings) },
      { name: 'Retread programme', value: round(retreadSavings) },
      { name: 'Downtime reduction', value: round(downtimeReduction) },
      { name: 'Emergency premium avoided', value: round(emergencyPremiumSavings) },
      { name: 'Compliance fines avoided', value: round(complianceFineAvoidance) },
      { name: 'Fuel efficiency', value: round(fuelSavings) },
    ].filter((b) => b.value > 0),
    projection: [1, 2, 3].map((year) => ({
      year: `Year ${year}`,
      savings: round(totalAnnualSavings * year),
      cost: round(programmeAnnualCost * year),
      net: round(netSavings * year),
    })),
  }
}
