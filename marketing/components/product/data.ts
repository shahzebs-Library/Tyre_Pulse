/* Invented sample data for the product recreations. No real asset, serial, site or brand. */
export type Tone = "good" | "warn" | "bad";
export type Wheel = { id: string; serial: string; brand: string; psi: number; cond: string; km: number; life: number; tone: Tone };

export const ASSET = { code: "MX-214", type: "Transit mixer 6x4", site: "Riyadh", odo: "184,220 km" };
export const MEDIAN_PSI = 118;

/* Ten tyres: one steer axle, two dual drive axles. Position codes as the app prints them. */
export const WHEELS: Wheel[] = [
  { id: "LHF1", serial: "RM-2208-117", brand: "Brand A", psi: 120, cond: "Good", km: 38400, life: 48, tone: "good" },
  { id: "RHF1", serial: "RM-2208-121", brand: "Brand A", psi: 119, cond: "Good", km: 38400, life: 48, tone: "good" },
  { id: "LHR1-O", serial: "DX-4471-208", brand: "Brand C", psi: 98, cond: "Sidewall cut", km: 61240, life: 77, tone: "bad" },
  { id: "LHR1-I", serial: "DX-4471-213", brand: "Brand C", psi: 117, cond: "Good", km: 61240, life: 77, tone: "good" },
  { id: "RHR1-I", serial: "DX-4471-197", brand: "Brand C", psi: 118, cond: "Good", km: 61240, life: 77, tone: "good" },
  { id: "RHR1-O", serial: "DX-4471-205", brand: "Brand C", psi: 116, cond: "Worn", km: 66900, life: 84, tone: "warn" },
  { id: "LHR2-O", serial: "DX-5102-031", brand: "Brand B", psi: 118, cond: "Good", km: 22150, life: 28, tone: "good" },
  { id: "LHR2-I", serial: "DX-5102-034", brand: "Brand B", psi: 117, cond: "Good", km: 22150, life: 28, tone: "good" },
  { id: "RHR2-I", serial: "DX-5102-029", brand: "Brand B", psi: 118, cond: "Good", km: 22150, life: 28, tone: "good" },
  { id: "RHR2-O", serial: "DX-5102-040", brand: "Brand B", psi: 119, cond: "Good", km: 22150, life: 28, tone: "good" },
];

export const AXLES: string[][] = [
  ["LHF1", "RHF1"],
  ["LHR1-O", "LHR1-I", "RHR1-I", "RHR1-O"],
  ["LHR2-O", "LHR2-I", "RHR2-I", "RHR2-O"],
];

export const fmt = (n: number) => n.toLocaleString("en-US");
