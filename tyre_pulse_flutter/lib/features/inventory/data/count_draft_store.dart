/// Encrypted, per-user storage for count sessions in progress.
///
/// # Why not the SQLite drafts table
///
/// The app's SQLite database is NOT encrypted at rest (`openTyrePulseDatabase`
/// is a plain `driftDatabase`, docs/inventory/05 finding 5). Count drafts carry
/// the counter's id, audit ids and what was found where, so they are kept in
/// the app's [SecureKeyValueStore] (Android Keystore / iOS Keychain backed,
/// the same store `WorkforceAssignmentCache` uses), which is encrypted.
///
/// # Rules
///
/// * One slot PER USER (`inventory_count_drafts_v1:<userId>`). Another user
///   signed in on a shared phone reads a different slot and can never see,
///   overwrite or submit someone else's counts.
/// * Unsynced counts are the only copy, so they are NEVER deleted for being
///   old or on sign-out. A session is removed only once every line in it has
///   been accepted by the server ([prune]).
/// * Every read-modify-write goes through [SecureKeyValueStore.updateValue],
///   which REFUSES to write when the read failed, so a Keystore hiccup cannot
///   replace a day of counting with an empty map.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

final class CountDraftStore {
  const CountDraftStore(this._store);

  final SecureKeyValueStore _store;

  static String slotFor(String userId) => 'inventory_count_drafts_v1:$userId';

  /// Every saved session of [userId], keyed by audit id. Throws
  /// [StorageReadFailure] when the store could not be read: the caller must
  /// say so rather than show "nothing saved".
  Future<Map<String, CountSession>> loadAll(String userId) async {
    final read = await _store.read(slotFor(userId));
    if (read.failed) {
      throw StorageReadFailure(key: slotFor(userId), status: read.status);
    }
    return _decode(read.value, userId);
  }

  Future<CountSession?> load(String userId, String auditId) async =>
      (await loadAll(userId))[auditId];

  /// Saves [session] under its own user's slot.
  Future<void> save(CountSession session) => _store.updateValue(
        slotFor(session.userId),
        (String? current) {
          final Map<String, CountSession> all =
              _decode(current, session.userId);
          all[session.auditId] = session;
          return _encode(all);
        },
      );

  /// Drops [auditId]'s session only when nothing in it is still pending.
  /// Returns true when it was removed.
  Future<bool> prune(String userId, String auditId) async {
    bool removed = false;
    await _store.updateValue(slotFor(userId), (String? current) {
      final Map<String, CountSession> all = _decode(current, userId);
      final CountSession? session = all[auditId];
      if (session != null && session.pending.isEmpty) {
        all.remove(auditId);
        removed = true;
      }
      return all.isEmpty ? null : _encode(all);
    });
    return removed;
  }

  static Map<String, CountSession> _decode(String? raw, String userId) {
    if (raw == null || raw.isEmpty) return <String, CountSession>{};
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map) {
      throw const FormatException('count drafts slot is not an object');
    }
    final Map<String, CountSession> out = <String, CountSession>{};
    final Object? sessions = decoded['sessions'];
    if (sessions is Map) {
      sessions.forEach((Object? key, Object? value) {
        if (value is Map) {
          final CountSession s =
              CountSession.fromJson(Map<String, Object?>.from(value));
          // Defence in depth: a session belonging to someone else is never
          // surfaced even if it somehow landed in this slot.
          if (s.userId == userId) out['$key'] = s;
        }
      });
    }
    return out;
  }

  static String _encode(Map<String, CountSession> all) =>
      jsonEncode(<String, Object?>{
        'version': 1,
        'sessions': <String, Object?>{
          for (final MapEntry<String, CountSession> e in all.entries)
            e.key: e.value.toJson(),
        },
      });
}
