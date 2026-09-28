/**
 * Illustrative sample data for the product screens drawn on the marketing
 * site. None of it is a customer record: asset codes, names and figures are
 * invented for the mockups, and every screen that shows them carries a
 * "Sample data" label.
 */

export type Tone = "red" | "amber" | "green" | "blue" | "grey" | "yellow";

export const STATUS_TONE: Record<string, Tone> = {
  "In workshop": "blue",
  "In progress": "blue",
  "Due today": "red",
  "Awaiting parts": "amber",
  "Pending approval": "amber",
  Approved: "green",
  "In service": "green",
  Available: "green",
  "In job": "amber",
  Scheduled: "blue",
  Active: "green",
  High: "red",
  Medium: "amber",
  Low: "grey",
  Open: "blue",
  "Ready to close": "green",
  Good: "green",
  Issue: "amber",
  "Not safe": "red",
};

export const PRIORITY_WORK = [
  { asset: "MX-104", desc: "Hydraulic leak, investigate", cat: "Corrective", status: "In workshop", pri: "High", who: "M. Khan", site: "Riyadh", due: "12 Mar 2026" },
  { asset: "GN-022", desc: "500-hour service", cat: "Preventive", status: "Due today", pri: "High", who: "S. Al Harbi", site: "Riyadh", due: "12 Mar 2026" },
  { asset: "WL-018", desc: "Brake inspection", cat: "Inspection", status: "Awaiting parts", pri: "Medium", who: "R. Santos", site: "Site 2", due: "13 Mar 2026" },
  { asset: "TR-331", desc: "Engine oil change", cat: "Preventive", status: "In progress", pri: "Medium", who: "A. Rahman", site: "Riyadh", due: "12 Mar 2026" },
  { asset: "DT-006", desc: "Replace front tyres", cat: "Tyres", status: "Approved", pri: "Medium", who: "K. Pillai", site: "Site 3", due: "14 Mar 2026" },
];

export const ASSETS = [
  { asset: "WL-018", model: "Wheel loader 966-class", type: "Wheel loader", status: "In service", site: "Site 2", hours: "6,240" },
  { asset: "EX-021", model: "Excavator 20 t", type: "Excavator", status: "In service", site: "Site 1", hours: "4,893" },
  { asset: "DT-006", model: "Articulated dump truck", type: "Dump truck", status: "In service", site: "Riyadh", hours: "7,512" },
  { asset: "TR-331", model: "Tipper 6x4", type: "Truck", status: "In service", site: "Riyadh", hours: "5,221" },
  { asset: "MX-104", model: "Transit mixer 10 m3", type: "Mixer", status: "In workshop", site: "Site 1", hours: "6,104" },
];

export const ASSET_HISTORY = [
  { date: "12 Mar 2026", type: "Meter reading", desc: "Meter reading updated", value: "6,240 h", by: "M. Khan" },
  { date: "10 Mar 2026", type: "Inspection", desc: "Daily walkaround, 2 issues", value: "6,226 h", by: "A. Patel" },
  { date: "05 Mar 2026", type: "Work order", desc: "WO-4521 completed, 500-hour service", value: "6,120 h", by: "J. Thompson" },
  { date: "01 Mar 2026", type: "Tyre", desc: "Front left tyre replaced", value: "6,090 h", by: "R. Santos" },
  { date: "24 Feb 2026", type: "Work order", desc: "WO-4490 completed, hydraulic leak fix", value: "5,980 h", by: "M. Khan" },
];

export const WORK_ORDERS = [
  { wo: "WO-4582", asset: "WL-018", desc: "Hydraulic leak, front left cylinder", type: "Corrective", pri: "High", status: "Pending approval", who: "Unassigned", due: "12 Mar 2026" },
  { wo: "WO-4581", asset: "TR-331", desc: "Engine oil change", type: "Preventive", pri: "Medium", status: "In progress", who: "A. Patel", due: "12 Mar 2026" },
  { wo: "WO-4580", asset: "DT-006", desc: "Replace front tyres", type: "Tyres", pri: "Medium", status: "Approved", who: "K. Pillai", due: "14 Mar 2026" },
  { wo: "WO-4543", asset: "EX-021", desc: "500-hour service", type: "Preventive", pri: "Medium", status: "Scheduled", who: "R. Santos", due: "15 Mar 2026" },
  { wo: "WO-4521", asset: "WL-018", desc: "Brake inspection", type: "Inspection", pri: "High", status: "In workshop", who: "M. Khan", due: "12 Mar 2026" },
];

export const TECHNICIANS = [
  { name: "M. Khan", role: "Mechanic", status: "Available" },
  { name: "R. Santos", role: "Mechanic", status: "In job" },
  { name: "A. Patel", role: "Technician", status: "Available" },
  { name: "K. Pillai", role: "Technician", status: "Available" },
];

export const PARTS = [
  { name: "Hydraulic hose", no: "123-4567", qty: 1 },
  { name: "Hose clamp", no: "765-4321", qty: 2 },
  { name: "Hydraulic oil (20 L)", no: "HYD-20", qty: 1 },
];

export const INVENTORY = [
  { part: "123-4567", desc: "Hydraulic hose", cat: "Hydraulics", stock: 12, reorder: 5, loc: "Riyadh", cost: "SAR 450.00" },
  { part: "765-4321", desc: "Hose clamp", cat: "Hydraulics", stock: 46, reorder: 20, loc: "Riyadh", cost: "SAR 25.00" },
  { part: "HYD-OIL-20", desc: "Hydraulic oil (20 L)", cat: "Lubricants", stock: 22, reorder: 10, loc: "Site 2", cost: "SAR 180.00" },
  { part: "TYR-29.5R25", desc: "Loader tyre 29.5R25", cat: "Tyres", stock: 8, reorder: 4, loc: "Site 3", cost: "SAR 3,850.00" },
  { part: "FLTR-001", desc: "Engine air filter", cat: "Engine", stock: 15, reorder: 6, loc: "Riyadh", cost: "SAR 320.00" },
];

/** Monthly maintenance spend by category, in SAR thousands. Illustrative. */
export const SPEND = [
  { m: "Jan", tyres: 38, preventive: 52, corrective: 44, parts: 20 },
  { m: "Feb", tyres: 30, preventive: 48, corrective: 58, parts: 18 },
  { m: "Mar", tyres: 42, preventive: 55, corrective: 40, parts: 24 },
  { m: "Apr", tyres: 36, preventive: 60, corrective: 52, parts: 22 },
  { m: "May", tyres: 48, preventive: 57, corrective: 46, parts: 26 },
  { m: "Jun", tyres: 40, preventive: 62, corrective: 38, parts: 21 },
];
