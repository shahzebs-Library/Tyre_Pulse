/// Offline support for the technician's My Jobs screen.
///
/// Three small pieces, each best-effort so none of them can block a tap:
///
/// * [WorkshopOfflineCache] - the last successfully loaded jobs and events,
///   kept in the encrypted [SecureKeyValueStore] with the same privacy rules
///   as `features/my_work/data/workforce_assignment_cache.dart` (one slot,
///   stamped with the owner's user id, deleted on the first read by anyone
///   else, discarded once older than [WorkshopOfflineCache.maxAge]). A
///   technician who opens the screen in a dead spot sees their jobs instead
///   of a full-screen error.
/// * [workshopEventsFromQueue] - turns this user's still-unsynced
///   `WORKSHOP_EVENT` commands back into local event copies, so the live
///   status survives closing and reopening the screen before the queue has
///   drained.
/// * [WorkshopPartsRequester] - files a `parts_requests` row for "Request
///   parts". That table has NO `client_uuid` column (V296), so it cannot be
///   replayed safely from the offline queue; it is an ONLINE-ONLY insert and
///   a failure is reported to the technician, never silently dropped.
library;

import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

/// What the cache hands back.
final class WorkshopOfflineSnapshot {
  const WorkshopOfflineSnapshot({
    required this.jobs,
    required this.events,
    required this.cachedAt,
  });

  final List<WorkshopJob> jobs;
  final List<WorkshopEventRecord> events;
  final DateTime cachedAt;
}

class WorkshopOfflineCache {
  const WorkshopOfflineCache(
    this._store, {
    DateTime Function() clock = DateTime.now,
    this.maxAge = const Duration(days: 7),
  }) : _clock = clock;

  final SecureKeyValueStore _store;
  final DateTime Function() _clock;

  /// A snapshot older than this is discarded rather than shown as current.
  final Duration maxAge;

  static const String slot = 'workshop_jobs_cache_v1';

  Future<void> save({
    required String userId,
    required List<WorkshopJob> jobs,
    required List<WorkshopEventRecord> events,
  }) async {
    if (userId.isEmpty) return;
    try {
      await _store.write(
        slot,
        jsonEncode(<String, Object?>{
          'userId': userId,
          'cachedAt': _clock().toUtc().toIso8601String(),
          'jobs': <Map<String, Object?>>[
            for (final WorkshopJob j in jobs) j.toRow(),
          ],
          'events': <Map<String, Object?>>[
            for (final WorkshopEventRecord e in events) e.toRow(),
          ],
        }),
      );
    } on Object {
      // Best effort: the live data is already on screen.
    }
  }

  Future<WorkshopOfflineSnapshot?> load(String userId) async {
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
      if (decoded['userId'] != userId) {
        await clear();
        return null;
      }
      final DateTime cachedAt = DateTime.parse(decoded['cachedAt'] as String);
      if (_clock().toUtc().difference(cachedAt.toUtc()) > maxAge) {
        await clear();
        return null;
      }
      final List<WorkshopJob> jobs = <WorkshopJob>[
        for (final Object? row in decoded['jobs'] as List<dynamic>)
          if (row is Map)
            if (WorkshopJob.fromRow(
              Map<String, dynamic>.from(row),
              role: row['role'] as String?,
            )
                case final WorkshopJob j)
              j,
      ];
      final List<WorkshopEventRecord> events = <WorkshopEventRecord>[
        for (final Object? row in decoded['events'] as List<dynamic>)
          if (row is Map)
            if (WorkshopEventRecord.fromRow(Map<String, dynamic>.from(row))
                case final WorkshopEventRecord e)
              e,
      ];
      return WorkshopOfflineSnapshot(
        jobs: jobs,
        events: events,
        cachedAt: cachedAt,
      );
    } on Object {
      await clear();
      return null;
    }
  }

  Future<void> clear() async {
    try {
      await _store.delete(slot);
    } on Object {
      // Best effort.
    }
  }
}

/// This user's unsynced workshop taps, as local event copies.
///
/// `at` comes from the payload (the tap time, see
/// `SupabaseWorkshopRepository.recordEvent`), falling back to the queue
/// row's own capture time for a command queued by an older build.
List<WorkshopEventRecord> workshopEventsFromQueue(
  Iterable<PendingCommand> commands, {
  required String userId,
}) {
  final String wire = CommandType.workshopEvent.wireName;
  final List<WorkshopEventRecord> out = <WorkshopEventRecord>[];
  for (final PendingCommand c in commands) {
    if (c.commandType != wire) continue;
    final Map<String, dynamic> payload;
    try {
      final Object? decoded = jsonDecode(c.payloadJson);
      if (decoded is! Map<String, dynamic>) continue;
      payload = decoded;
    } on Object {
      continue;
    }
    if (payload['user_id'] != userId) continue;
    final Object? type = payload['event_type'];
    if (type is! String || type.isEmpty) continue;
    final Object? at = payload['at'];
    out.add(
      WorkshopEventRecord(
        eventType: type,
        jobId: payload['job_id'] as String?,
        reasonCode: payload['reason_code'] as String?,
        clientUuid: c.idempotencyKey,
        localAt: (at is String ? DateTime.tryParse(at) : null) ?? c.createdAt,
      ),
    );
  }
  return out;
}

/// One "Request parts" row.
final class WorkshopPartsRequestInput {
  const WorkshopPartsRequestInput({
    required this.partName,
    required this.qty,
    required this.requestedBy,
    this.jobId,
    this.assetNo,
    this.site,
    this.country,
    this.notes,
  });

  final String partName;
  final num qty;
  final String requestedBy;
  final String? jobId;
  final String? assetNo;
  final String? site;
  final String? country;
  final String? notes;
}

abstract interface class WorkshopPartsRequester {
  /// Inserts the request. Throws `SupabaseFailure` on any failure.
  Future<void> request(WorkshopPartsRequestInput input);
}

/// `parts_requests` is not in `SupabaseTables` yet (that registry is owned
/// elsewhere); the literal lives here, in the one class that writes it.
const String _partsRequestsTable = 'parts_requests';

final class SupabaseWorkshopPartsRequester
    with SupabaseGateway
    implements WorkshopPartsRequester {
  SupabaseWorkshopPartsRequester(this._client);

  final SupabaseClient _client;

  @override
  Future<void> request(WorkshopPartsRequestInput input) async {
    await guard<void>(() async {
      await _client.from(_partsRequestsTable).insert(<String, Object?>{
        'part_name': input.partName,
        'qty': input.qty,
        'job_id': input.jobId,
        'asset_no': input.assetNo,
        'site': input.site,
        'country': input.country,
        'requested_by': input.requestedBy,
        'notes': input.notes,
      });
    });
  }
}
