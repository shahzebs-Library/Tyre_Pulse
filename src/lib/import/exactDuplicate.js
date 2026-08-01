const DEFAULT_SKIP = new Set([
  'id', 'organisation_id', 'organization_id', 'org_id', 'created_at', 'updated_at',
  'uploaded_by', 'upload_batch_id', 'client_uuid',
])

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])]),
  )
}

export function duplicateComparable(value) {
  if (value == null || String(value).trim() === '') return ''
  if (typeof value === 'object') return JSON.stringify(stableObject(value))
  const text = String(value).trim().toLowerCase()
  return /^\d{4}-\d{2}-\d{2}[t ]/.test(text) ? text.slice(0, 10) : text
}

/** True only when every field supplied by the upload matches the live row. */
export function isExactSuppliedRow(uploaded, live, { skip = DEFAULT_SKIP } = {}) {
  if (!uploaded || !live) return false
  const keys = Object.keys(uploaded).filter((key) => !skip.has(key))
  return keys.length > 0 && keys.every(
    (key) => duplicateComparable(uploaded[key]) === duplicateComparable(live[key]),
  )
}
