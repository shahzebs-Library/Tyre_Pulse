import { supabase, applyCountry, fetchAllPages, unwrap } from './_client'
import { escapeLike } from '../searchFilter'
export async function findSerialRecords(serial, { country, columns = '*' } = {}) {
  const key = String(serial || '').trim()
  if (!key) return []
  const result = await fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records').select(columns)
    .ilike('serial_no', escapeLike(key)), country).order('issue_date', { ascending: true }).order('id').range(from, to), { max: 20000 })
  if (result.truncated) throw new Error('This serial has too many records to display completely. Narrow the country selection.')
  return unwrap(result) || []
}
