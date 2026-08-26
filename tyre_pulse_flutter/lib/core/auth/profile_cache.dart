/// The offline profile cache: the last profile row the app itself verified
/// from the server, kept so a cold start with no signal is not a lockout.
///
/// Ported from `cacheProfile` / `readCachedProfile` / `clearCachedProfile` in
/// `mobile/contexts/AuthContext.tsx`. That file's own comment records exactly
/// why this exists: a tyre man whose account was created for him by an admin,
/// who does not know his own username and has never seen his password, must
/// not be dropped onto a login screen he cannot pass because a fetch failed -
/// while his session, and his unsynced field work, sit untouched on the
/// device.
///
/// # What this does and does not grant
///
/// Reading from this cache unlocks the LOCAL shell and this user's own queued
/// work. It grants NO data access whatsoever: every read still needs a live
/// session and still passes RLS server-side, so a revoked account reaches
/// nothing no matter how long a stale cache lives on the device. See
/// `auth_lifecycle.dart`'s [profileCacheMaxAge] for the bound and the argument
/// for it being 90 days rather than something shorter.
///
/// # Why the RAW row, not a re-serialised `WorkspaceProfile`
///
/// `WorkspaceProfile` (`lib/core/workspace/workspace_context.dart`) has a
/// single canonical decoder, `WorkspaceProfile.fromRow`. Caching the raw
/// `profiles` row and decoding it through that SAME function on read - rather
/// than inventing a second encode/decode pair for the cached shape - is what
/// guarantees the cached path and the live path can never silently disagree
/// about what a column means. This file never constructs a `WorkspaceProfile`
/// itself; that decoding is the caller's job - see
/// `auth_profile_repository.dart`.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/auth/auth_lifecycle.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';

/// A cached profile row, together with when it was written.
final class CachedProfile {
  const CachedProfile({
    required this.userId,
    required this.cachedAt,
    required this.row,
  });

  /// The user this row was cached for. Compared against the CURRENT session's
  /// user id before the cache is ever used - a cache written for one account
  /// must never be read for another, which is exactly the hazard a shared
  /// device creates.
  final String userId;

  final DateTime cachedAt;

  /// The raw `profiles` row, exactly as PostgREST returned it, so it can be
  /// decoded through the same `WorkspaceProfile.fromRow` the live path uses.
  final Map<String, Object?> row;
}

/// Reads and writes the single-slot offline profile cache.
///
/// One instance per app, over the [SecureKeyValueStore] the storage layer
/// provides. Every method here is best-effort: a write failure never blocks
/// sign-in (matches the React Native `.catch(() => { /* cache is best effort
/// */ })`), and a read failure - a storage fault as opposed to a genuinely
/// empty slot - collapses to "no usable cache" rather than throwing, because a
/// caller of [load] already treats every kind of "nothing to offer" the same
/// way. See [load] for exactly which cases that covers.
final class ProfileCache {
  const ProfileCache(this._store);

  final SecureKeyValueStore _store;

  /// The storage slot. Versioned so a future change to the cached shape can
  /// migrate by simply choosing a new key and abandoning the old one, rather
  /// than needing to parse a mixture of old and new payloads.
  static const String _key = 'tp_profile_cache_v1';

  /// Saves [row] as the verified profile for [userId].
  ///
  /// Never throws. A failure here costs nothing but the cache's usefulness
  /// next time the device is offline - it must not be allowed to turn a
  /// successful sign-in into a reported failure.
  Future<void> save(String userId, Map<String, Object?> row) async {
    try {
      final String payload = jsonEncode(<String, Object?>{
        'userId': userId,
        'at': DateTime.now().toUtc().toIso8601String(),
        'row': row,
      });
      await _store.write(_key, payload);
    } on Object {
      // Best effort. See the method comment.
    }
  }

  /// The cached row for [wantUserId], only when [isCachedProfileUsable] would
  /// accept it - right user, within [profileCacheMaxAge], and not cached from
  /// an account that was already locked or unapproved when it was written.
  ///
  /// Returns null for anything else: no cache, a different user's cache, a
  /// stale cache, a cache this device could not read, or a cache this file
  /// could not parse. Every one of those cases is treated identically by a
  /// caller - fall through to reporting the fetch as failed - so this
  /// deliberately does not distinguish them further.
  Future<Map<String, Object?>?> load(String wantUserId) async {
    final CachedProfile? cached = await _readEntry();
    if (cached == null) {
      return null;
    }

    final Map<String, Object?> row = cached.row;
    final bool usable = isCachedProfileUsable(
      cachedForUserId: cached.userId,
      wantUserId: wantUserId,
      cachedAt: cached.cachedAt,
      now: DateTime.now().toUtc(),
      locked: _boolField(row, 'locked'),
      approved: _boolField(row, 'approved'),
    );
    return usable ? cached.row : null;
  }

  /// Removes the cache. Called on sign-out so the NEXT account on this device
  /// can never inherit a profile that was never theirs, and called after a
  /// live fetch confirms an account is locked or unapproved so a stale copy
  /// cannot be read back as current.
  ///
  /// Never throws. Clearing a cache is a hygiene action, not a security
  /// boundary - the boundary is that a read from this cache grants no data
  /// access at all, regardless of whose id is in it.
  Future<void> clear() async {
    try {
      await _store.delete(_key);
    } on Object {
      // Best effort. See the method comment.
    }
  }

  Future<CachedProfile?> _readEntry() async {
    final SecureRead read;
    try {
      read = await _store.read(_key);
    } on Object {
      // The store's contract is that a read never throws - see
      // `SecureKeyValueStore`'s own class comment - but this file does not
      // rely on that holding for every implementation a test might supply.
      // Either way the outcome is the same: no usable cache.
      return null;
    }

    // Both `unreadable` and `absent` collapse to "no usable cache" here.
    // `SecureReadStatus.torn`/`unreadable` are storage FAULTS, not evidence
    // that nothing was ever cached, but this cache is advisory - a caller
    // already treats "no usable cache" as one outcome regardless of cause
    // (fall through to reporting the profile fetch as failed), so there is
    // nothing a finer distinction here would change.
    final String? text = read.value;
    if (text == null || text.isEmpty) {
      return null;
    }

    try {
      final Object? decoded = jsonDecode(text);
      if (decoded is! Map<String, dynamic>) {
        return null;
      }
      final Object? userId = decoded['userId'];
      final Object? at = decoded['at'];
      final Object? row = decoded['row'];
      if (userId is! String || userId.isEmpty) {
        return null;
      }
      if (at is! String) {
        return null;
      }
      final DateTime? cachedAt = DateTime.tryParse(at);
      if (cachedAt == null) {
        return null;
      }
      if (row is! Map<String, dynamic>) {
        return null;
      }
      return CachedProfile(userId: userId, cachedAt: cachedAt, row: row);
    } on FormatException {
      // Written by an earlier, incompatible version of this cache, or
      // corrupted. Read as "nothing cached", never as a crash.
      return null;
    }
  }

  static bool? _boolField(Map<String, Object?> row, String key) {
    final Object? value = row[key];
    return value is bool ? value : null;
  }
}
