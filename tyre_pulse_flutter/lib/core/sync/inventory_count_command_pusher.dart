/// Uploads a queued blind count line's photos, then sends the line.
///
/// `INVENTORY_COUNT_LINE` is queued with each line's still-local photo paths
/// under [localPhotosKey]. This decorator runs immediately before the
/// `inv_count_submit` RPC and, per line:
///
/// 1. uploads every local photo to the deterministic object path
///    `inventory_count/<audit>/<client_uuid>/<file name>` with `upsert`, so a
///    retry after a crash or a lost answer overwrites the same object and
///    never creates a second one;
/// 2. appends the resulting `tp-storage://` reference to the line's `photos`;
/// 3. removes [localPhotosKey], so no device path ever reaches the server.
///
/// Only when every photo of every line has a server reference is the RPC
/// called. A failed upload throws a [SupabaseFailure] (the [CommandPusher]
/// contract), the RPC is never called, and [SyncEngine] classifies and
/// retries it exactly like any other push failure - the server therefore
/// never holds a line whose evidence is still only on a phone.
///
/// # A local photo that is no longer on the phone
///
/// The app deletes a count photo only after the server has ACCEPTED that line
/// (`CountSubmitter`, after a manual Send). So a missing file means the line is
/// already stored; its reference is the same deterministic path, and the RPC
/// answers the replay as a duplicate, which the engine settles as synced.
///
/// Every other command passes through to [_delegate] unchanged, so the
/// protected queue/registry/engine wiring is untouched (the same decorator
/// pattern as `AccidentEvidenceCommandPusher`).
library;

import 'dart:io';

import 'package:drift/drift.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

/// The per-line key carrying photo paths that are still only on this phone.
/// Never sent to the server.
const String localPhotosKey = 'local_photo_paths';

/// The private bucket count photos live in (mirrors `inventoryPhotoBucket`).
const String inventoryCountPhotoBucket = 'tyre-photos';

/// The object path a count photo is stored at. Deterministic on purpose.
String inventoryCountPhotoPath({
  required String auditId,
  required String clientUuid,
  required String localPath,
}) {
  final String name = localPath.split(RegExp(r'[\\/]')).last;
  return 'inventory_count/$auditId/$clientUuid/$name';
}

/// Uploads one count photo. Must throw only [SupabaseFailure].
typedef CountPhotoPut = Future<void> Function({
  required String bucket,
  required String objectPath,
  required String localPath,
});

final class InventoryCountCommandPusher implements CommandPusher {
  const InventoryCountCommandPusher({
    required CommandPusher delegate,
    required CountPhotoPut putPhoto,
    Future<bool> Function(String path) fileExists = _fileExists,
    String bucket = inventoryCountPhotoBucket,
    Future<String?> Function(String idempotencyKey)? priorRefusal,
  })  : _delegate = delegate,
        _put = putPhoto,
        _exists = fileExists,
        _bucket = bucket,
        _priorRefusal = priorRefusal;

  /// The production wiring: uploads through Supabase Storage, and reads an
  /// earlier server refusal from this device's own sync failure log.
  factory InventoryCountCommandPusher.supabase({
    required CommandPusher delegate,
    required SupabaseClient client,
    AppDatabase? db,
  }) =>
      InventoryCountCommandPusher(
        delegate: delegate,
        putPhoto: _SupabaseCountPhotoStore(client).put,
        priorRefusal: db == null ? null : (String k) => priorRefusalIn(db, k),
      );

  final CommandPusher _delegate;
  final CountPhotoPut _put;
  final Future<bool> Function(String path) _exists;
  final String _bucket;
  final Future<String?> Function(String idempotencyKey)? _priorRefusal;

  static Future<bool> _fileExists(String path) async => File(path).existsSync();

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    if (spec.type != CommandType.inventoryCountLine) {
      return _delegate.push(
        spec: spec,
        payload: payload,
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      );
    }
    // A line the server already REFUSED is never sent again: the queue's
    // shared backoff re-claims every failed row (up to
    // QueueRetryPolicy.maxRetries, then `failed`), and re-calling the server
    // with a deterministic refusal is the retry-loop class. The earlier
    // answer is replayed locally instead, so the row keeps its reason and
    // runs out its retries without network or upload traffic.
    final String? key = _lineKey(payload);
    final String? refused =
        key == null || _priorRefusal == null ? null : await _priorRefusal(key);
    if (key != null && refused != null) {
      return <Map<String, Object?>>[
        <String, Object?>{
          'accepted': const <String>[],
          'duplicates': const <String>[],
          'rejected': <Object?>[
            <String, Object?>{'client_uuid': key, 'reason': refused},
          ],
        },
      ];
    }
    final Map<String, Object?> resolved = await _resolve(payload);
    return _delegate.push(
      spec: spec,
      payload: resolved,
      matchValue: matchValue,
      expectedPriorStatus: expectedPriorStatus,
    );
  }

  static String? _lineKey(Map<String, Object?> payload) {
    final Object? lines = payload['lines'];
    if (lines is! List || lines.length != 1) return null;
    final Object? line = lines.single;
    if (line is! Map) return null;
    final Object? key = line['client_uuid'];
    return key is String && key.isNotEmpty ? key : null;
  }

  Future<Map<String, Object?>> _resolve(Map<String, Object?> payload) async {
    final Object? auditId = payload['audit_id'];
    final Object? rawLines = payload['lines'];
    if (auditId is! String || auditId.isEmpty || rawLines is! List) {
      throw _countFailure('The queued count has no audit or no lines.');
    }
    final List<Map<String, Object?>> lines = <Map<String, Object?>>[];
    for (final Object? raw in rawLines) {
      if (raw is! Map) {
        throw _countFailure('A queued count line is not an object.');
      }
      final Map<String, Object?> line = Map<String, Object?>.from(raw);
      final Object? local = line.remove(localPhotosKey);
      if (local is List && local.isNotEmpty) {
        final Object? clientUuid = line['client_uuid'];
        if (clientUuid is! String || clientUuid.isEmpty) {
          throw _countFailure('A queued count line has no client identity.');
        }
        final List<Object?> refs = <Object?>[
          ...?(line['photos'] as List<Object?>?),
        ];
        for (final Object? p in local) {
          if (p is! String || p.isEmpty) continue;
          final String objectPath = inventoryCountPhotoPath(
            auditId: auditId,
            clientUuid: clientUuid,
            localPath: p,
          );
          final String ref = 'tp-storage://$_bucket/$objectPath';
          if (refs.contains(ref)) continue;
          if (await _exists(p)) {
            // Throws SupabaseFailure on failure: the RPC is then never called.
            await _put(bucket: _bucket, objectPath: objectPath, localPath: p);
          }
          refs.add(ref);
        }
        line['photos'] = refs;
      }
      lines.add(line);
    }
    return <String, Object?>{...payload, 'lines': lines};
  }
}

/// The server's reason for an earlier refusal of the queued line [key], read
/// from this device's own `sync_failures` log (class `conflict`), or null.
Future<String?> priorRefusalIn(AppDatabase db, String key) async {
  final PendingCommand? command =
      await db.queueDao.commandByIdempotencyKey(key);
  if (command == null) return null;
  final SyncFailure? hit = await (db.select(db.syncFailures)
        ..where(
          (t) =>
              t.commandId.equals(command.id) &
              t.errorClass.equals(SyncErrorClass.conflict),
        )
        ..orderBy([(t) => OrderingTerm.desc(t.occurredAt)])
        ..limit(1))
      .getSingleOrNull();
  final String? reason = hit?.messageSafe?.trim();
  return reason == null || reason.isEmpty ? null : reason;
}

final class _SupabaseCountPhotoStore extends SupabaseGateway {
  _SupabaseCountPhotoStore(this._client);

  final SupabaseClient _client;

  Future<void> put({
    required String bucket,
    required String objectPath,
    required String localPath,
  }) {
    return guard<void>(() async {
      await _client.storage.from(bucket).upload(
            objectPath,
            File(localPath),
            fileOptions: const FileOptions(upsert: true),
          );
    });
  }
}

SupabaseFailure _countFailure(String technical) {
  return SupabaseFailure(
    error: AppError(
      kind: AppErrorKind.sync,
      message: 'This count could not be prepared for sending. '
          'It remains on this device; open the count and tap Send.',
      technical: technical,
      isRetryable: false,
    ),
    cause: SupabaseFailureCause.invalidInput,
    rawMessage: technical,
  );
}
