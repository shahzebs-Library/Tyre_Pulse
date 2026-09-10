import fs from 'node:fs';
let p='src/lib/api/tyrePassport.js',s=fs.readFileSync(p,'utf8');
const a=s.indexOf('  const [serviceEvents, warrantyClaims, statusMarks, retreadClaims] = await Promise.all(['),b=s.indexOf('\n}',a);
s=s.slice(0,a)+`  const sources = [
    ['serviceEvents', 'Service and repair history', () => getServiceEvents(serial, { country })],
    ['warrantyClaims', 'Warranty claims', () => getWarrantyClaims(serial, { country })],
    ['statusMarks', 'Tyre status marks', () => getStatusMarks(serial)],
    ['retreadClaims', 'Retread claims', () => getRetreadClaims(serial, { country })],
  ]
  const settled = await Promise.allSettled(sources.map(([, , load]) => load()))
  const bundle = { records, unavailableSources: [] }
  settled.forEach((result, i) => {
    const [key, label] = sources[i]
    bundle[key] = result.status === 'fulfilled' ? result.value : []
    if (result.status === 'rejected') bundle.unavailableSources.push(label)
  })
  return bundle`+s.slice(b);
s=s.replaceAll('    if (isMissingRelation(err)) return []\n    throw err','    throw err');fs.writeFileSync(p,s);
p='src/pages/TyrePassport.jsx';s=fs.readFileSync(p,'utf8');s=s.replace("  const [bundle, setBundle] = useState(null)","  const [bundle, setBundle] = useState(null)\n  const loadId = useRef(0)");
s=s.replace("    if (!sn) { setBundle(null); return }\n    setLoading(true); setError('')", "    const request = ++loadId.current\n    setBundle(null)\n    if (!sn) { setLoading(false); return }\n    setLoading(true); setError('')");
s=s.replace("      setBundle(await getPassportBundle(sn, { country: activeCountry }))", "      const result = await getPassportBundle(sn, { country: activeCountry })\n      if (request === loadId.current) setBundle(result)");
s=s.replace("      setError(toUserMessage(err, 'Could not load this tyre.')); setBundle({ records: [] })", "      if (request === loadId.current) { setError(toUserMessage(err, 'Could not load this tyre.')); setBundle(null) }");
s=s.replace("    } finally { setLoading(false) }", "    } finally { if (request === loadId.current) setLoading(false) }");
s=s.replace("  useEffect(() => { if (serial) load(serial) }, [serial, load])", "  useEffect(() => { load(serial); return () => { loadId.current++ } }, [serial, load])");
s=s.replace("      {serial && (", "      {!!bundle?.unavailableSources?.length && <p role=\"alert\" className=\"card text-sm text-amber-500\">Some history could not be loaded: {bundle.unavailableSources.join(', ')}. This passport is incomplete; refresh to try again.</p>}\n      {serial && (");fs.writeFileSync(p,s);
p='src/pages/PmPrograms.jsx';s=fs.readFileSync(p,'utf8').replace('useMemo, useCallback','useMemo, useCallback, useRef');
s=s.replace('export default function PmPrograms() {','export default function PmPrograms() {\n  const loadId = useRef(0)\n  const [dataWarning, setDataWarning] = useState(\'\')');
s=s.replace("    setRefreshing(true); setError(''); setMissing(false)", "    const request = ++loadId.current\n    setRefreshing(true); setError(''); setMissing(false); setDataWarning('')\n    setDashboard(null); setHistory(null); setCost(null)");
s=s.replace('listPmServiceRecords({ country: activeCountry }).catch(() => [])','listPmServiceRecords({ country: activeCountry })');
s=s.replace("loadGovernedCostSplit({ country: activeCountry }).catch(() => ({ tyre: 0, maintenance: 0, byMonth: [] }))", "loadGovernedCostSplit({ country: activeCountry }).catch(() => null)");
s=s.replace("      setDashboard(dash ||", "      if (request !== loadId.current) return\n      if (!split) setDataWarning('Cost information could not be loaded. Cost totals are unavailable.')\n      setDashboard(dash ||");
s=s.replace('setCost(split || { tyre: 0, maintenance: 0, byMonth: [] })','setCost(split)');
s=s.replace("    } catch (err) {\n      if (isMissingRelation(err))", "    } catch (err) {\n      if (request !== loadId.current) return\n      if (isMissingRelation(err))");
s=s.replace('setHistory([]); setCost({ tyre: 0, maintenance: 0, byMonth: [] })','setHistory([]); setCost(null)');
s=s.replace('      setRefreshing(false)\n    }\n  }, [activeCountry])', '      if (request === loadId.current) setRefreshing(false)\n    }\n  }, [activeCountry])');
s=s.replace('useEffect(() => { load() }, [load])','useEffect(() => { load(); return () => { loadId.current++ } }, [load])');
s=s.replace('      {recordOk && (', '      {dataWarning && <p role="alert" className="card text-sm text-amber-500">{dataWarning}</p>}\n      {recordOk && (');fs.writeFileSync(p,s);
p='src/pages/CpkIntelligence.jsx';s=fs.readFileSync(p,'utf8').replace('useCallback, lazy','useCallback, useRef, lazy');s=s.replace('export default function CpkIntelligence() {','export default function CpkIntelligence() {\n  const loadId = useRef(0)');s=s.replace('    let cancelled = false\n    setLoading(true)', '    const request = ++loadId.current\n    let cancelled = false\n    setFleetCpk({ perVehicle: [], byType: [], fleet: [] })\n    setLoading(true)');
const start=s.indexOf('  const load = useCallback('),end=s.indexOf('  useEffect(() => load()',start);const seg=s.slice(start,end).replaceAll('if (!cancelled)', 'if (!cancelled && request === loadId.current)');s=s.slice(0,start)+seg+s.slice(end);s=s.replace('    getTyrePriceBasis({ country })','    setPriceBasis(null)\n    getTyrePriceBasis({ country })');s=s.replace("    setAdvLoading(true)","    setDrivers({ ok: false, windows: null, segments: [] }); setBrandRows([])\n    setAdvLoading(true)");fs.writeFileSync(p,s);
