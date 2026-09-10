import fs from 'node:fs';
let p='src/lib/api/vehicleHistory.js',s=fs.readFileSync(p,'utf8').replace('supabase, fetchAllPages','supabase, fetchAllPages, applyCountry');
const start=s.indexOf('/**\n * Corrective actions related');
s=s.slice(0,start)+`// Related records are linked by the exact asset number, never a substring in
// free text (TM1 must not inherit a TM10 action). Preserve active country scope.
async function assetRows(table, columns, assetNo, { country } = {}, date = 'created_at') {
  const result = await fetchAllPages((from, to) => applyCountry(supabase.from(table).select(columns)
    .eq('asset_no', assetNo), country).order(date, { ascending: false }).order('id').range(from, to), { max: 20000 })
  if (result.truncated) return { data: [], error: new Error('Asset history is too large to load completely. Narrow the country selection.') }
  return result
}
export function listAssetActions(assetNo, options) {
  return assetRows('corrective_actions', 'id,title,status,priority,due_date,site,created_at', assetNo, options)
}
export function listAssetRca(assetNo, options) {
  return assetRows('rca_records', 'id,asset_no,root_cause,tyre_serial,brand,site,created_at', assetNo, options)
}
export function listAssetInspections(assetNo, options) {
  return assetRows('inspections', 'id,asset_no,status,site,created_at', assetNo, options)
}
export function listAssetTyreRecords(assetNo, options) {
  return assetRows('tyre_records', 'position,risk_level,brand,serial_no,issue_date', assetNo, options, 'issue_date')
}
`;fs.writeFileSync(p,s);
p='src/pages/VehicleHistory.jsx';s=fs.readFileSync(p,'utf8');for(const fn of ['listAssetActions','listAssetRca','listAssetInspections','listAssetTyreRecords']) s=s.replace(`${fn}(selected)`,`${fn}(selected, { country: activeCountry })`);
s=s.replace("      if (cancelled) return\n      setRelatedActions", "      if (cancelled) return\n      const failed = [actRes, rcaRes, insRes, tyreRes].find(r => r.error)\n      if (failed) setError(toUserMessage(failed.error, 'Some related asset history could not be loaded.'))\n      setRelatedActions");s=s.replace('    loadRelated()\n    return', "    setRelatedActions([]); setRelatedRca([]); setRelatedInspections([]); setTyrePositions([])\n    loadRelated().catch(err => { if (!cancelled) setError(toUserMessage(err, 'Could not load related asset history.')) })\n    return");s=s.replace('  }, [selected])','  }, [selected, activeCountry])');fs.writeFileSync(p,s);
p='src/lib/api/pmPrograms.js';s=fs.readFileSync(p,'utf8');const a=s.indexOf('export async function listPmPrograms('),b=s.indexOf('\nexport async function getPmProgram',a);
s=s.slice(0,a)+`export async function listPmPrograms({ country, status } = {}) {
  const result = await fetchAllPages((from, to) => {
    let q = supabase.from('pm_programs').select(COLS)
    if (status) q = q.eq('status', status)
    return applyCountry(q, country).order('next_due', { ascending: true, nullsFirst: false }).order('id').range(from, to)
  }, { max: 50000 })
  if (result.truncated) throw new Error('Too many maintenance programs to load completely. Narrow the country selection.')
  return unwrap(result) || []
}
`+s.slice(b);
s=s.replace("await supabase\n        .from('vehicle_fleet').select('asset_no,current_km').in('asset_no', c)", "await applyCountry(supabase\n        .from('vehicle_fleet').select('asset_no,current_km').in('asset_no', c), country)");
s=s.replace('if (r && r.asset_no != null) kmByAsset[r.asset_no] = Number(r.current_km)', 'if (r && r.asset_no != null && r.current_km != null && Number.isFinite(Number(r.current_km))) kmByAsset[r.asset_no] = Number(r.current_km)');
s=s.replace("await supabase\n        .from('engine_hours_logs').select('asset_no,engine_hours,reading_date')\n        .in('asset_no', c).order('reading_date', { ascending: false })", "await applyCountry(supabase\n        .from('engine_hours_logs').select('asset_no,engine_hours,reading_date')\n        .in('asset_no', c).order('reading_date', { ascending: false }), country)");s=s.replace("r.asset_no != null && !(r.asset_no in hoursByAsset)", "r.asset_no != null && r.engine_hours != null && Number.isFinite(Number(r.engine_hours)) && !(r.asset_no in hoursByAsset)");fs.writeFileSync(p,s);
p='src/test/vehicleHistory.api.test.js';s=fs.readFileSync(p,'utf8').replace("listAssetActions matches asset_no OR description mention, limit 20",'listAssetActions requires exact asset identity and pages all history').replace("expect(h.state.last._calls.or).toContain('asset_no.eq.A1,description.ilike.%A1%')", "expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])\n    expect(h.state.last._calls.or).toHaveLength(0)").replaceAll('filters by asset_no, limit 20','filters by asset_no and pages history').replaceAll('expect(h.state.last._calls.limit).toBe(20)','expect(h.state.last._calls.range.length).toBeGreaterThan(0)');fs.writeFileSync(p,s);
