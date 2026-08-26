/// Deep link handling: sanitising a target, and holding one that arrived
/// before the router could act on it.
///
/// Artifact 03 section 4.4: a notification tap on a KILLED app does not reach a
/// listener the way a warm tap does. The production app handles it in four
/// moves and all four are needed here:
///
/// 1. read the stored response on boot, before subscribing;
/// 2. de-duplicate against the live listener, or the app navigates twice and
///    stacks a duplicate screen;
/// 3. queue the navigation until the router is mounted - navigating earlier
///    throws;
/// 4. a blank or unknown target STAYS PUT.
///
/// Moves 1 and 2 belong to whoever owns the notification plugin. Move 3 is
/// [TpPendingDeepLink]: the notification layer parks a target here, and the
/// shell drains it once it is mounted. Move 4 is [sanitizeInternalLocation].
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A backslash. Written as a raw string because a bare escape in a character
/// class is the kind of thing that silently stops matching after a refactor.
const String _kBackslash = r'\';

/// Returns [location] if it is a location inside this application, else null.
///
/// This is an OPEN REDIRECT guard, and it is not hypothetical for this product:
/// the web application shipped exactly this class of check after a router
/// advisory, and had to cover the BACKSLASH forms because browsers normalise
/// `\` to `/`. A deep link arrives from outside the app - a notification
/// payload, an intent, a scanned code - so it is untrusted input.
///
/// Rejected:
/// - anything empty or blank
/// - anything not starting with `/` (an absolute URL, a scheme, a bare word)
/// - `//host` and `/\host`, which navigate off-origin
/// - any string containing a backslash at all
/// - control characters, which can hide the rest of a string from a reviewer
String? sanitizeInternalLocation(String? location) {
  if (location == null) return null;
  final String value = location.trim();
  if (value.isEmpty) return null;

  if (!value.startsWith('/')) return null;
  if (value.contains(_kBackslash)) return null;
  if (value.startsWith('//')) return null;

  for (final int unit in value.codeUnits) {
    // C0 controls and DEL. A newline in a location is never legitimate.
    if (unit < 0x20 || unit == 0x7F) return null;
  }

  return value;
}

/// A deep link that arrived before it could be acted on.
///
/// Holds AT MOST ONE. A queue would replay a stale tap from ten minutes ago
/// after the user had already navigated somewhere by hand.
class TpPendingDeepLink extends Notifier<String?> {
  @override
  String? build() => null;

  /// Parks a target. An unsafe or blank target is dropped rather than stored,
  /// so nothing downstream has to decide whether to trust it.
  void offer(String? location) {
    final String? safe = sanitizeInternalLocation(location);
    if (safe == null) return;
    state = safe;
  }

  /// Takes the pending target and clears it.
  ///
  /// Call this from a post-frame callback or an event handler, NEVER from a
  /// router redirect or a build method: mutating a provider while the widget
  /// tree is building throws, and a redirect runs during route parsing.
  String? take() {
    final String? current = state;
    if (current == null) return null;
    state = null;
    return current;
  }

  void clear() => state = null;
}

final NotifierProvider<TpPendingDeepLink, String?> pendingDeepLinkProvider =
    NotifierProvider<TpPendingDeepLink, String?>(TpPendingDeepLink.new);
