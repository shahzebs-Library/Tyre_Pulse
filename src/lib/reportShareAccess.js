/** Server-denied share links must not keep displaying cached board data.
 * Network failures and backend outages are intentionally excluded so a
 * temporary connection problem can preserve the last successfully loaded TV.
 * Pure helper, shared by the viewer and regression tests.
 */
export function mustClearShareSnapshot(result) {
  if (result?.ok) return false
  return ['revoked', 'expired', 'invalid', 'forbidden'].includes(result?.reason)
}
