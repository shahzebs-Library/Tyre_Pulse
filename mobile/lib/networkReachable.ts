/**
 * isNetworkUsable
 *
 * Whether it is worth ATTEMPTING a sync right now, given an expo-network
 * `NetworkState`. This is deliberately looser than "isConnected AND
 * isInternetReachable" - both useNetworkSync and SyncBanner used to require
 * BOTH flags, and isInternetReachable is a secondary reachability probe that
 * expo-network itself documents as `boolean | undefined`, not a hard truth:
 *
 *   - On iOS it is always the same as isConnected (see expo-network's own
 *     Network.types.d.ts), so requiring it there costs nothing but adds
 *     nothing either.
 *   - On Android it comes from ConnectivityManager.getActiveNetwork() (API
 *     29+) or NetInfo.isConnected() (older), both of which can legitimately
 *     lag a moment behind the connectivity-change EVENT that just fired -
 *     captive portals, VPN-only routes, or simply the OS not having updated
 *     its reachability marker within the same tick. When that happens this
 *     field reads `false` or `undefined` for a device that is, in fact,
 *     online, and BOTH the reconnect listener and the periodic safety poll
 *     used to silently refuse to even try a sync - which reads exactly like
 *     "connected but still waiting forever" from the field.
 *
 * A sync attempt that runs while genuinely offline is not free, but it is
 * cheap and already safe: every caller of Network.getNetworkStateAsync() /
 * addNetworkStateListener here feeds straight into a try/catch'd upload that
 * no-ops on failure. So the only thing an over-eager sync can do wrong is one
 * wasted round trip; the only thing an over-strict gate can do wrong is
 * stranding real, already-saved field work on the device indefinitely. Given
 * that asymmetry, only a DEFINITE "no internet" (isInternetReachable===false)
 * should ever block an attempt - an unresolved/undefined reading must not.
 */
import type { NetworkState } from 'expo-network'

export function isNetworkUsable(state: NetworkState | null | undefined): boolean {
  if (!state) return false
  return !!state.isConnected && state.isInternetReachable !== false
}
