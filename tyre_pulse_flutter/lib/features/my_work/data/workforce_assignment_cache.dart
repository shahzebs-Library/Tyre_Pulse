/// The offline cache for company work assignments.
///
/// # Privacy rules
///
/// * Stored only in the app's encrypted [SecureKeyValueStore] (Android
///   Keystore / iOS Keychain backed), never in plain preferences or a file.
/// * ONE slot, stamped with the owner's user id. A different signed-in user
///   can therefore never read it, and the first read by another user deletes
///   it, so one person's task list does not outlive their session on a shared
///   device.
/// * Cleared on sign-out (see `afterSignOutProvider`) and discarded once older
///   than [maxAge], so a long-offline phone cannot show weeks-old
///   instructions as if they were current.
/// * Every method is best-effort. A storage fault must never block loading
///   live data or signing out.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';

final class WorkforceAssignmentCache {
  const WorkforceAssignmentCache(
    this._store, {
    DateTime Function() clock = DateTime.now,
    this.maxAge = const Duration(days: 30),
  }) : _clock = clock;

  final SecureKeyValueStore _store;
  final DateTime Function() _clock;

  /// Cached assignments older than this are discarded rather than shown.
  final Duration maxAge;

  /// Versioned so a future shape change can simply pick a new key.
  static const String slot = 'workforce_assignments_cache_v2';

  /// Saves [rows] as the assignments of [userId], replacing any earlier slot.
  Future<void> save({
    required String userId,
    required List<Map<String, Object?>> rows,
  }) async {
    try {
      await _store.write(
        slot,
        jsonEncode(<String, Object?>{
          'userId': userId,
          'cachedAt': _clock().toUtc().toIso8601String(),
          'rows': rows,
        }),
      );
    } on Object {
      // Best effort: the live data was already returned to the caller.
    }
  }

  /// The cached rows for [userId], or null when there is nothing usable.
  ///
  /// A slot written for someone else, an expired slot and a corrupt slot are
  /// all deleted and reported as null.
  Future<List<Map<String, Object?>>?> load(String userId) async {
    final String? raw;
    try {
      raw = (await _store.read(slot)).value;
    } on Object {
      return null;
    }
    if (raw == null) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) throw const FormatException();
      final Object? owner = decoded['userId'];
      final Object? stamp = decoded['cachedAt'];
      final Object? rows = decoded['rows'];
      if (owner != userId) {
        await clear();
        return null;
      }
      if (stamp is! String || rows is! List<dynamic>) {
        throw const FormatException();
      }
      final DateTime cachedAt = DateTime.parse(stamp);
      if (_clock().toUtc().difference(cachedAt.toUtc()) > maxAge) {
        await clear();
        return null;
      }
      return <Map<String, Object?>>[
        for (final Object? row in rows)
          Map<String, Object?>.from(row! as Map<dynamic, dynamic>),
      ];
    } on Object {
      await clear();
      return null;
    }
  }

  /// Removes the slot. Never throws.
  Future<void> clear() async {
    try {
      await _store.delete(slot);
    } on Object {
      // Best effort.
    }
  }
}
