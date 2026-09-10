import fs from 'node:fs'; let p,s;
p='src/lib/api/shifts.js';s=fs.readFileSync(p,'utf8').replace('applyCountry, isMissingRelation','applyCountry, isMissingRelation, fetchAllPages');
const a=s.indexOf('export async function listShifts('),b=s.indexOf('\nexport async function getShift',a);
s=s.slice(0,a)+`export async function listShifts({ country, status } = {}) {
  const result = await fetchAllPages((from, to) => {
    let q = supabase.from('shifts').select(COLS)
    if (status) q = q.eq('status', status)
    return applyCountry(q, country).order('shift_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }).order('id').range(from, to)
  }, { max: 50000 })
  if (result.truncated) throw new Error('Too many shifts to load completely. Narrow the country selection.')
  return unwrap(result) || []
}
`+s.slice(b);fs.writeFileSync(p,s);
p='src/lib/api/pmPrograms.js';s=fs.readFileSync(p,'utf8');
// Preserve existing imports and use the shared paging helper.
s=s.replace('isMissingRelation }', 'isMissingRelation, fetchAllPages }');
if(!s.includes('fetchAllPages }')) throw new Error('Inspect PM imports');
const start=s.indexOf('export async function listPmServiceRecords('),end=s.indexOf('\n/**',start);
s=s.slice(0,start)+`export async function listPmServiceRecords({ asset_no, program_id, country } = {}) {
  const result = await fetchAllPages((from, to) => {
    let q = supabase.from('pm_service_records').select(SERVICE_RECORD_COLS)
    if (asset_no) q = q.eq('asset_no', asset_no)
    if (program_id) q = q.eq('pm_program_id', program_id)
    return applyCountry(q, country).order('service_date', { ascending: false }).order('id').range(from, to)
  }, { max: 50000 })
  if (result.truncated) throw new Error('Service history is too large to load completely. Narrow the selection.')
  return unwrap(result) || []
}
`+s.slice(end);fs.writeFileSync(p,s);
