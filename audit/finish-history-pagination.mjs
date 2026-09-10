import fs from 'node:fs';
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')));
edit('src/lib/api/tyrePassport.js',s=>{const start=s.indexOf('/**\n * Tyre service events');const end=s.indexOf('/**\n * Fetch the full passport');return s.slice(0,start)+`/** Auxiliary histories are paged; failures are identified in the bundle. */
async function serialHistory(table, columns, column, serial, country, date = 'created_at') {
  const value = String(serial || '').trim()
  if (!value) return []
  const result = await fetchAllPages((from, to) => {
    let q = applyCountry(supabase.from(table).select(columns).eq(column, value), country)
    if (table === 'tyre_status_marks') q = q.order('serial').order('mark_type')
    else q = q.order(date, { ascending: false }).order('id')
    return q.range(from, to)
  }, { max: 20000 })
  if (result.truncated) throw new Error('This history exceeds the display limit.')
  return unwrap(result) || []
}
export function getServiceEvents(serial, { country } = {}) {
  return serialHistory('tyre_service_events', SERVICE_EVENT_COLS, 'tyre_serial', serial, country, 'event_date')
}
export function getWarrantyClaims(serial, { country } = {}) {
  return serialHistory('warranty_claims', WARRANTY_COLS, 'serial_number', serial, country)
}
export function getStatusMarks(serial) {
  return serialHistory('tyre_status_marks', 'serial,mark_type', 'serial', serial)
}
export function getRetreadClaims(serial, { country } = {}) {
  return serialHistory('retread_claims', RETREAD_COLS, 'tyre_serial', serial, country)
}

`+s.slice(end)});
edit('src/lib/api/pmPrograms.js',s=>s.replace('  const chunks = chunk(assetNos, 200)','  const chunks = chunk(assetNos, 200)\n  const seenFleetAssets = new Set()\n  const ambiguousAssets = new Set()').replace('      for (const r of data || []) {\n        if (r && r.asset_no != null && r.current_km', '      for (const r of data || []) {\n        if (seenFleetAssets.has(r.asset_no)) ambiguousAssets.add(r.asset_no)\n        seenFleetAssets.add(r.asset_no)\n        if (r && r.asset_no != null && r.current_km').replace('  return { plans, kmByAsset, hoursByAsset }\n}', '  // An asset number can exist in more than one country. Do not assign an\n  // arbitrary meter to a plan when the selected scope is ambiguous.\n  for (const asset of ambiguousAssets) { delete kmByAsset[asset]; delete hoursByAsset[asset] }\n  return { plans, kmByAsset, hoursByAsset }\n}'));
// Suppress only the irrelevant DOM-ref cleanup warning: these refs are request counters.
for(const p of ['PmPrograms','PredictiveMaintenance','QrLabels','SerialTracker','TyrePassport','WorkshopLive']) edit('src/pages/'+p+'.jsx',s=>s.replace(/^(.*(?:return \(\) => \{ (?:loadId|queryId)\.current\+\+|^\s+loadId\.current\+\+).*)$/gm,'    // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.\n$1'));
