/// Records a Stock Count as a physical count line, not as a stock change.
///
/// # Why
///
/// A count difference needs an approver (owner decision 2026-11-24, WP5
/// migration `20261124091000`): `set_stock_count` and the
/// `adjustment_up/down` movements now refuse anyone without
/// `adjustment_approve` with "A count difference needs approval. Record it as
/// a physical count; an approver posts the adjustment." So a Store Keeper's
/// count is stored as EVIDENCE through the existing physical inventory
/// capture (`inv_pi_capture`), which never touches the balance. Reconciling
/// the evidence into an adjustment stays an approver's job on the web.
///
/// # Offline
///
/// The capture goes into the existing encrypted, per-user physical inventory
/// outbox (`PhysicalCaptureOutbox`), which the foreground binding and the
/// background worker already flush. It is keyed by its own client_uuid, so a
/// retry never stores it twice. Only the SESSION needs the network the first
/// time a store is counted: the session id is remembered per country and
/// store on this phone, so later counts in the same store work offline.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

/// What happened to a recorded count.
enum StockCountRecordResult {
  /// The server holds the count line.
  sent,

  /// Saved in the outbox on this phone; it is sent when the network is back.
  savedOnPhone,
}

/// Why a count could not even be saved on the phone.
enum StockCountRecordProblem {
  /// The stock line has no store (site) or the country is unknown.
  noPlace,

  /// No count session is known for this store and the phone is offline.
  needsConnectionForSession,

  /// The phone's encrypted store could not be read or written.
  storage,
}

final class StockCountRecordFailure implements Exception {
  const StockCountRecordFailure(this.problem, {this.cause});
  final StockCountRecordProblem problem;
  final Object? cause;

  @override
  String toString() => 'StockCountRecordFailure($problem)';
}

/// The server refused the count line (kept in the outbox with its reason; the
/// physical inventory screen lists it under "needs attention").
final class StockCountRefused implements Exception {
  const StockCountRefused(this.message);
  final String message;

  @override
  String toString() => 'StockCountRefused($message)';
}

/// The capture for one counted stock line. Pure, for tests.
PendingCapture stockCountCapture({
  required StockItem item,
  required num count,
  required String? reason,
  required String clientUuid,
  required String userId,
  required String sessionId,
  required DateTime capturedAt,
}) {
  final String? itemId = _blank(item.itemId);
  final String? description = _blank(item.description);
  final String kind = itemId != null
      ? 'identified'
      : (description != null ? 'proposed_new' : 'unidentified');
  return PendingCapture(
    clientUuid: clientUuid,
    userId: userId,
    sessionId: sessionId,
    kind: kind,
    quantity: count.toDouble(),
    capturedAt: capturedAt,
    itemId: itemId,
    label: description,
    refs: <String, String>{
      'stock_id': item.id,
      if (description != null) 'description': description,
      'source': 'stock_count',
    },
    condition:
        piConditions.contains(item.condition) ? item.condition! : 'unknown',
    ownership:
        piOwnerships.contains(item.ownership) ? item.ownership! : 'owned',
    locationId: _blank(item.locationId),
    remarks: _blank(reason),
  );
}

String? _blank(String? v) {
  final String s = (v ?? '').trim();
  return s.isEmpty ? null : s;
}

final class StockCountRecorder {
  StockCountRecorder({
    required PhysicalInventoryRepository repository,
    required PhysicalCaptureOutbox outbox,
    required SecureKeyValueStore store,
    required String Function() newId,
    DateTime Function()? now,
  })  : _repository = repository,
        _outbox = outbox,
        _store = store,
        _newId = newId,
        _now = now ?? DateTime.now;

  final PhysicalInventoryRepository _repository;
  final PhysicalCaptureOutbox _outbox;
  final SecureKeyValueStore _store;
  final String Function() _newId;
  final DateTime Function() _now;

  static String sessionSlot(String userId) =>
      'stock_count_pi_sessions_v1:$userId';

  static String placeKey(String country, String site) =>
      '${country.trim().toLowerCase()}|${site.trim().toUpperCase()}';

  Future<Map<String, String>> _remembered(String userId) async {
    final SecureRead read = await _store.read(sessionSlot(userId));
    if (read.failed || (read.value ?? '').isEmpty) return <String, String>{};
    try {
      final Object? decoded = jsonDecode(read.value!);
      if (decoded is! Map) return <String, String>{};
      return <String, String>{
        for (final MapEntry<Object?, Object?> e in decoded.entries)
          '${e.key}': '${e.value}',
      };
    } on FormatException {
      return <String, String>{};
    }
  }

  Future<void> _remember(String userId, String key, String? sessionId) async {
    try {
      await _store.updateValue(sessionSlot(userId), (String? raw) {
        Map<String, Object?> m = <String, Object?>{};
        if (raw != null && raw.isNotEmpty) {
          try {
            final Object? d = jsonDecode(raw);
            if (d is Map) m = Map<String, Object?>.from(d);
          } on FormatException {
            m = <String, Object?>{};
          }
        }
        if (sessionId == null) {
          m.remove(key);
        } else {
          m[key] = sessionId;
        }
        return m.isEmpty ? null : jsonEncode(m);
      });
    } on Object {
      // A session that could not be remembered is found again next time.
    }
  }

  /// The open count session for this store: the one remembered on this
  /// phone when the server still lists it open, else any open session for
  /// the store, else a new one. Offline, the remembered one is used as is.
  Future<String> _sessionFor({
    required String userId,
    required String country,
    required String site,
  }) async {
    final String key = placeKey(country, site);
    final String? known = (await _remembered(userId))[key];
    List<PhysicalSession> open;
    try {
      open = await _repository.openSessions();
    } on SupabaseFailure catch (f) {
      if (f.isConnectivity && known != null) return known;
      if (f.isConnectivity) {
        throw StockCountRecordFailure(
          StockCountRecordProblem.needsConnectionForSession,
          cause: f,
        );
      }
      rethrow;
    }
    bool samePlace(PhysicalSession s) =>
        s.isOpen && placeKey(s.country ?? '', s.site) == key;
    for (final PhysicalSession s in open) {
      if (s.id == known && samePlace(s)) return s.id;
    }
    for (final PhysicalSession s in open) {
      if (samePlace(s) && s.id.isNotEmpty) {
        await _remember(userId, key, s.id);
        return s.id;
      }
    }
    try {
      final PhysicalSession started = await _repository.startSession(
        idempotencyKey: _newId(),
        country: country,
        site: site,
      );
      if (started.id.isEmpty) {
        throw const StockCountRecordFailure(
          StockCountRecordProblem.needsConnectionForSession,
        );
      }
      await _remember(userId, key, started.id);
      return started.id;
    } on SupabaseFailure catch (f) {
      if (f.isConnectivity) {
        throw StockCountRecordFailure(
          StockCountRecordProblem.needsConnectionForSession,
          cause: f,
        );
      }
      rethrow;
    }
  }

  /// Saves the count for [item] and tries to send it now.
  ///
  /// Throws [StockCountRecordFailure] when nothing could be saved,
  /// [StockCountRefused] when the server refused the line (it stays on the
  /// phone with the reason), or a [SupabaseFailure] for any other refusal
  /// while finding or starting the session.
  Future<StockCountRecordResult> record({
    required StockItem item,
    required num count,
    required String? reason,
    required String userId,
    required String? orgId,
    String? fallbackCountry,
    String? deviceId,
  }) async {
    final String? site = _blank(item.site);
    final String? fb = _blank(fallbackCountry);
    final String? country =
        _blank(item.country) ?? (fb == null || fb == 'All' ? null : fb);
    if (site == null || country == null) {
      throw const StockCountRecordFailure(StockCountRecordProblem.noPlace);
    }
    final String sessionId =
        await _sessionFor(userId: userId, country: country, site: site);
    final PendingCapture capture = stockCountCapture(
      item: item,
      count: count,
      reason: reason,
      clientUuid: _newId(),
      userId: userId,
      sessionId: sessionId,
      capturedAt: _now(),
    );
    try {
      await _outbox.add(capture);
    } on Object catch (e) {
      throw StockCountRecordFailure(StockCountRecordProblem.storage, cause: e);
    }
    if (orgId == null || orgId.isEmpty) {
      return StockCountRecordResult.savedOnPhone;
    }
    try {
      await _outbox.flush(
        userId: userId,
        orgId: orgId,
        repository: _repository,
        deviceId: deviceId,
      );
    } on Object {
      return StockCountRecordResult.savedOnPhone;
    }
    final List<PendingCapture> left;
    try {
      left = await _outbox.pending(userId);
    } on Object {
      return StockCountRecordResult.savedOnPhone;
    }
    for (final PendingCapture c in left) {
      if (c.clientUuid != capture.clientUuid) continue;
      final String? err = c.lastError;
      if (err != null && !c.captureSent) {
        // A session closed on the web since it was remembered: forget it so
        // the next count starts or finds an open one.
        if (err.toLowerCase().contains('session')) {
          await _remember(userId, placeKey(country, site), null);
        }
        throw StockCountRefused(err);
      }
      // Sent, but a photo or confirmation is still waiting.
      return c.captureSent
          ? StockCountRecordResult.sent
          : StockCountRecordResult.savedOnPhone;
    }
    return StockCountRecordResult.sent;
  }
}
