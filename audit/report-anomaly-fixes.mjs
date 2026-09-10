import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('src/lib/tyreRunningLife.js',s=>s.replace('remainingDays: num(r.remaining_days),','remainingDays: num(r.expected_days) > 0 ? num(r.remaining_days) : null,').replace("if (remaining === 0) return 'overdue'","if (remaining <= 0 || (used != null && used >= 100)) return 'overdue'").replace('  const km = {\n    dimension:',`  // A fixed 10,000-km warning must not flag a tyre whose entire life is shorter.
  const kmLimit = row.expectedLifeKm > 0 ? Math.min(DUE_SOON_KM, row.expectedLifeKm * 0.1) : DUE_SOON_KM
  const hoursLimit = row.expectedLifeHours > 0 ? Math.min(DUE_SOON_HOURS, row.expectedLifeHours * 0.1) : DUE_SOON_HOURS
  const km = {
    dimension:`).replace('row.remainingKm < DUE_SOON_KM','row.remainingKm < kmLimit').replace('dimensionBand(row.remainingKm, row.lifeUsedPct, DUE_SOON_KM)','dimensionBand(row.remainingKm, row.lifeUsedPct, kmLimit)').replace('row.remainingHours < DUE_SOON_HOURS','row.remainingHours < hoursLimit').replace('dimensionBand(row.remainingHours, row.hoursUsedPct, DUE_SOON_HOURS)','dimensionBand(row.remainingHours, row.hoursUsedPct, hoursLimit)'));
edit('src/pages/Anomalies.jsx',s=>s.replace('  const [partialScan, setPartialScan] = useState(false)','  const [partialScan, setPartialScan] = useState(false)\n  const [sourceWarning, setSourceWarning] = useState(\'\')').replace('    setLoading(true); setError(null)','    setLoading(true); setError(null); setSourceWarning(\'\'); setAnomalies([]); setVisitStats([]); setPartialScan(false)').replace('const { data: wo, truncated: woTruncated }','const { data: wo, error: woError, truncated: woTruncated }').replace('        workOrders = wo || []','        if (woError) throw woError\n        workOrders = wo || []').replace('      } catch { /* best-effort */ }',"      } catch { if (!stale()) setSourceWarning('Workshop records could not be loaded. Visit counts and anomaly results are incomplete; retry the scan.') }").replace('      {partialScan && !error && (','      {sourceWarning && !error && <p role="alert" className="card text-amber-500">{sourceWarning}</p>}\n      {partialScan && !error && (').replace("'No anomalies detected in this date range' : 'No anomalies detected'","'No anomalies detected in the available records for this date range' : 'No anomalies detected in the available records'"));
edit('src/lib/anomalyEngine.js',s=>s.replace('export function detectAnomalies(records, config = {}) {',`export function detectAnomalies(records, config = {}) {
  const countries = [...new Set((records || []).map(r => r.country || ''))]
  if (countries.length > 1) return countries.flatMap(country =>
    detectAnomalies(records.filter(r => (r.country || '') === country), config)
      .map(a => ({ ...a, country, id: JSON.stringify([country, a.id]) })))`).replace('export function computeVisitStats(records, opts = {}) {',`export function computeVisitStats(records, opts = {}) {
  const countries = [...new Set([...(records || []), ...(opts.workOrders || [])].map(r => r.country || ''))]
  if (countries.length > 1) return countries.flatMap(country =>
    computeVisitStats((records || []).filter(r => (r.country || '') === country), {
      ...opts, workOrders: (opts.workOrders || []).filter(r => (r.country || '') === country),
    }).map(row => ({ ...row, country }))).sort((a, b) => b.total - a.total)
`).replace('id: `FV::${s.asset_no}`','id: `FV::${s.country || \'\'}::${s.asset_no}`'));
edit('src/lib/checklist/fieldTypes.js',s=>s.replace('if (Number.isNaN(n))','if (!Number.isFinite(n))').replace('    if (field.min != null && n < Number(field.min))',"    if (n < 0 && /(?:\\bkm\\b|odometer|hour.?meter|engine.?hours|kilomet)/i.test(String(field.label || ''))) return `${name || 'Meter reading'} cannot be negative`\n    if (field.min != null && n < Number(field.min))"));
