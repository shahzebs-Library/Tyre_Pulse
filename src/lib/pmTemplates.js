/**
 * pmTemplates.js — a library of STANDARD Preventive Maintenance (PM) service
 * templates per asset category.
 *
 * IMPORTANT: these are SUGGESTED starting points — honest, editable engineering
 * defaults drawn from common OEM service practice. They are NOT live data and
 * NOT fabricated readings. A planner picks a template as a base and tweaks the
 * meter interval, calendar interval, priority and task list to match the actual
 * asset. Nothing here reads or invents a real service record.
 *
 * Every token used below comes from pmVocab.js (asset_category, priority,
 * meter_source) and every calendar interval_type is 'days' | 'months' so the
 * schedule engine (pmSchedule.addTimeInterval) can advance it. Meter-based
 * intervals are carried on meter_source + meter_interval (the km / hours axis),
 * exactly as a pm_programs row expects.
 *
 * DB RULE: do NOT write template labels straight to token columns — a template's
 * asset_category / priority / meter_source are ALREADY canonical lowercase
 * tokens, so applyTemplate can hand them to a pm_programs insert as-is.
 */

import { ASSET_CATEGORIES, PM_PRIORITIES, METER_SOURCES } from './pmVocab'

/**
 * PM_TEMPLATES — the standard library. Each entry:
 *   id              stable slug (unique)
 *   label           friendly name (no dashes / arrows / curly quotes)
 *   asset_category  vehicle | generator | plant | machinery | equipment | other
 *   meter_source    odometer | engine_hours | none
 *   meter_interval  units on the meter axis between services (0 when meter_source none)
 *   interval_type   days | months (the calendar axis)
 *   interval_value  positive integer count of interval_type
 *   priority        low | medium | high | critical
 *   tasks           ordered list of service task strings
 *   notes           short honest guidance
 */
export const PM_TEMPLATES = [
  {
    id: 'gen_250h_oil_filter',
    label: 'Generator 250h oil and filter service',
    asset_category: 'generator',
    meter_source: 'engine_hours',
    meter_interval: 250,
    interval_type: 'months',
    interval_value: 6,
    priority: 'high',
    tasks: [
      'Drain and replace engine oil',
      'Replace oil filter',
      'Replace fuel filter',
      'Inspect and clean air filter',
      'Check coolant level and condition',
      'Inspect belts and hoses',
      'Record running hours and load test',
    ],
    notes: 'Standard minor service. Bring the calendar interval forward for standby sets that run few hours.',
  },
  {
    id: 'gen_1000h_major',
    label: 'Generator 1000h major service',
    asset_category: 'generator',
    meter_source: 'engine_hours',
    meter_interval: 1000,
    interval_type: 'months',
    interval_value: 12,
    priority: 'critical',
    tasks: [
      'Full oil and all filters replacement',
      'Replace air filter element',
      'Replace coolant and pressure test cooling system',
      'Inspect and adjust valve clearances',
      'Test battery and charging system',
      'Clean and test control panel and safety shutdowns',
      'Full load bank test and record readings',
    ],
    notes: 'Major overhaul checkpoint. Schedule downtime and confirm spare parts on hand first.',
  },
  {
    id: 'veh_10000km_service',
    label: 'Vehicle 10000km or 6 month service',
    asset_category: 'vehicle',
    meter_source: 'odometer',
    meter_interval: 10000,
    interval_type: 'months',
    interval_value: 6,
    priority: 'medium',
    tasks: [
      'Replace engine oil and oil filter',
      'Rotate tyres and check tread depth',
      'Check and top up all fluids',
      'Inspect brakes and suspension',
      'Check tyre pressures and set to spec',
      'Road test and record faults',
    ],
    notes: 'Whichever comes first, distance or time. Adjust interval for severe duty cycles.',
  },
  {
    id: 'veh_brake_inspection',
    label: 'Vehicle brake inspection',
    asset_category: 'vehicle',
    meter_source: 'odometer',
    meter_interval: 20000,
    interval_type: 'months',
    interval_value: 3,
    priority: 'high',
    tasks: [
      'Measure brake pad and shoe wear',
      'Inspect discs and drums for scoring',
      'Check brake fluid level and moisture',
      'Inspect brake lines and hoses for leaks',
      'Test park brake holding force',
    ],
    notes: 'Safety critical. Shorten the interval for heavy or hilly routes.',
  },
  {
    id: 'veh_annual_safety',
    label: 'Vehicle annual safety and roadworthy check',
    asset_category: 'vehicle',
    meter_source: 'none',
    meter_interval: 0,
    interval_type: 'months',
    interval_value: 12,
    priority: 'high',
    tasks: [
      'Inspect lights, indicators and horn',
      'Check seat belts and mirrors',
      'Inspect steering and suspension play',
      'Check exhaust and emissions',
      'Verify registration and insurance validity',
    ],
    notes: 'Time driven compliance check, no meter axis. Align with local roadworthy renewal.',
  },
  {
    id: 'plant_monthly_greasing',
    label: 'Plant greasing and lubrication',
    asset_category: 'plant',
    meter_source: 'engine_hours',
    meter_interval: 500,
    interval_type: 'months',
    interval_value: 1,
    priority: 'medium',
    tasks: [
      'Grease all pivot points and bearings',
      'Check and top up hydraulic oil',
      'Inspect hydraulic hoses for wear',
      'Clean and lubricate slew ring',
      'Record grease points serviced',
    ],
    notes: 'Frequent lubrication protects pins and bushings. Increase frequency in dusty conditions.',
  },
  {
    id: 'plant_hydraulic_service',
    label: 'Plant hydraulic system service',
    asset_category: 'plant',
    meter_source: 'engine_hours',
    meter_interval: 2000,
    interval_type: 'months',
    interval_value: 12,
    priority: 'high',
    tasks: [
      'Replace hydraulic oil and return filter',
      'Replace hydraulic breather',
      'Inspect cylinders for leaks and rod damage',
      'Check pump and valve pressures',
      'Bleed system and function test all circuits',
    ],
    notes: 'Contaminated hydraulic oil is a top failure cause. Sample oil before draining if possible.',
  },
  {
    id: 'machinery_monthly_greasing',
    label: 'Machinery greasing and inspection',
    asset_category: 'machinery',
    meter_source: 'none',
    meter_interval: 0,
    interval_type: 'months',
    interval_value: 1,
    priority: 'medium',
    tasks: [
      'Grease all lubrication points',
      'Inspect drive belts and chains for tension',
      'Check guards and safety interlocks',
      'Listen for abnormal bearing noise',
      'Clean debris from moving parts',
    ],
    notes: 'Routine care for fixed machinery with no running meter. Log any abnormal wear.',
  },
  {
    id: 'machinery_500h_service',
    label: 'Machinery 500h operational service',
    asset_category: 'machinery',
    meter_source: 'engine_hours',
    meter_interval: 500,
    interval_type: 'months',
    interval_value: 6,
    priority: 'high',
    tasks: [
      'Change gearbox and drive oil',
      'Inspect and replace worn belts',
      'Check alignment and coupling',
      'Test motor current draw',
      'Verify emergency stop function',
    ],
    notes: 'Runs on operating hours. Confirm the hour meter reading before booking.',
  },
  {
    id: 'equipment_annual_calibration',
    label: 'Equipment annual calibration',
    asset_category: 'equipment',
    meter_source: 'none',
    meter_interval: 0,
    interval_type: 'months',
    interval_value: 12,
    priority: 'high',
    tasks: [
      'Calibrate against a certified reference',
      'Record as found and as left readings',
      'Adjust to tolerance and reseal',
      'Issue calibration certificate',
      'Apply next due calibration label',
    ],
    notes: 'Compliance driven. Use an accredited lab where certification is required.',
  },
  {
    id: 'equipment_quarterly_inspection',
    label: 'Equipment quarterly inspection',
    asset_category: 'equipment',
    meter_source: 'none',
    meter_interval: 0,
    interval_type: 'months',
    interval_value: 3,
    priority: 'medium',
    tasks: [
      'Inspect casing and cables for damage',
      'Check power supply and connections',
      'Clean sensors and contacts',
      'Verify readings against a known value',
      'Log condition and any defects',
    ],
    notes: 'Light periodic check between full calibrations. Escalate defects to a work order.',
  },
  {
    id: 'other_generic_periodic',
    label: 'Generic periodic maintenance',
    asset_category: 'other',
    meter_source: 'none',
    meter_interval: 0,
    interval_type: 'months',
    interval_value: 6,
    priority: 'low',
    tasks: [
      'Visual inspection for wear and damage',
      'Clean and check general condition',
      'Verify basic function',
      'Record findings and next actions',
    ],
    notes: 'Catch all baseline for assets without a specific plan. Replace with a tailored template when known.',
  },
]

/**
 * templatesFor(assetCategory) — templates whose asset_category matches. Passing
 * null / undefined / empty returns the full library (honest: no filter applied).
 * An unrecognised category returns an empty array (no silent bucketing).
 */
export function templatesFor(assetCategory) {
  if (assetCategory == null || assetCategory === '') return [...PM_TEMPLATES]
  const want = String(assetCategory).toLowerCase().trim()
  return PM_TEMPLATES.filter((t) => t.asset_category === want)
}

/**
 * applyTemplate(template, overrides) — turn a template into a pm_programs create
 * payload. Maps tasks -> task_list and defaults name to the template label. The
 * caller's overrides always win (asset selection, tuned intervals, notes). No id
 * or dates are set here — the insert / RPC assigns those.
 */
export function applyTemplate(template, overrides = {}) {
  const t = template || {}
  const base = {
    name: t.label ?? '',
    asset_category: t.asset_category ?? 'other',
    meter_source: t.meter_source ?? 'none',
    meter_interval: t.meter_interval ?? 0,
    interval_type: t.interval_type ?? 'months',
    interval_value: t.interval_value ?? 0,
    priority: t.priority ?? 'medium',
    task_list: Array.isArray(t.tasks) ? [...t.tasks] : [],
    notes: t.notes ?? '',
  }
  return { ...base, ...(overrides || {}) }
}

// Re-export the vocab token sets the tests and callers validate against.
export { ASSET_CATEGORIES, PM_PRIORITIES, METER_SOURCES }
