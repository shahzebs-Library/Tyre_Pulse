/// Real, Supabase-backed implementations of the two seams [SyncEngine]
/// pushes through: [SupabaseCommandPusher] and [SupabaseMediaUploader].
///
/// Kept out of `sync_engine.dart` deliberately. `sync_engine.dart`'s own
/// library comment explains why the reconciliation LOGIC must never import
/// `package:supabase_flutter/supabase_flutter.dart`; this file is the other
/// half of that split - the production adapters, with nowhere else to live.
///
/// Nothing in this file is exercised by a unit test, for the same reason
/// `background_sync.dart` has none: meaningfully testing a thin PostgREST or
/// Storage adapter needs either a live Supabase project or a fragile mock of
/// a fluent query builder, for very little assurance beyond what the
/// compiler and a manual smoke test already give. The behaviour worth
/// testing - what the sync engine DOES with a success, a conflict or a
/// failure - is exercised in `sync_engine_test.dart` against a fake that
/// implements the same two interfaces this file implements for real.
library;

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

/// Pushes one command's business row through PostgREST.
///
/// Every call runs through [SupabaseGateway.guard], so whatever it throws
/// always reaches [SyncEngine] as a `SupabaseFailure` and nothing else,
/// matching [CommandPusher]'s documented contract.
final class SupabaseCommandPusher extends SupabaseGateway
    implements CommandPusher {
  SupabaseCommandPusher(this._client);

  final SupabaseClient _client;

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) {
    return guard(() async {
      if (spec.operation == CommandOperation.rpc) {
        final String? fn = spec.rpc;
        if (fn == null) {
          throw StateError(
            'An RPC command needs CommandSpec.rpc (table: ${spec.table}).',
          );
        }
        // The answer is handed back as a one-row list; SyncEngine reads it.
        final Object? answer = await _client.rpc<Object?>(
          fn,
          params: <String, Object?>{'p_payload': payload},
        );
        return <Map<String, Object?>>[
          if (answer is Map) Map<String, Object?>.from(answer),
        ];
      }
      if (spec.operation == CommandOperation.insert) {
        // A plain insert, never `.upsert()`. See `sync_engine.dart`'s
        // library comment for why: several of the idempotent tables use a
        // PARTIAL unique index on `client_uuid`, which PostgREST's
        // `on_conflict` parameter cannot supply the predicate for, so an
        // upsert can fail with 42P10 even when the row already exists. A
        // plain insert enforces the same uniqueness correctly regardless,
        // and throws 23505 on a genuine duplicate for `SyncEngine` to
        // classify against the command's own retry count.
        final List<Map<String, dynamic>> rows =
            await _client.from(spec.table).insert(payload).select();
        return rows.cast<Map<String, Object?>>();
      }

      final String? matchColumn = spec.matchColumn;
      if (matchColumn == null || matchValue == null) {
        // A CommandRegistry entry for an update command with no match
        // column, or a caller that did not supply the value to match on, is
        // a programming error in this build - not a condition a retry can
        // resolve.
        throw StateError(
          'An update command needs both a matchColumn on its spec and a '
          'matchValue to push (table: ${spec.table}).',
        );
      }

      var query =
          _client.from(spec.table).update(payload).eq(matchColumn, matchValue);

      if (spec.requiresOptimisticStatusMatch) {
        if (expectedPriorStatus == null) {
          throw StateError(
            'This command requires an optimistic status match but no prior '
            'status was supplied (table: ${spec.table}).',
          );
        }
        // The optimistic-concurrency guard itself: only apply the change if
        // the row is still in the status this update was written against.
        // Zero rows back means somebody else changed it first - `SyncEngine`
        // reads that from the returned list rather than from a thrown
        // error, because it is a legitimate outcome of the query, not a
        // failure of it.
        query = query.eq('status', expectedPriorStatus);
      }

      final List<Map<String, dynamic>> rows = await query.select();
      return rows.cast<Map<String, Object?>>();
    });
  }
}

/// Uploads one queued photo to Supabase Storage.
///
/// Every call runs through [SupabaseGateway.guard], matching
/// [MediaUploader]'s documented contract exactly the same way
/// [SupabaseCommandPusher] does for [CommandPusher].
final class SupabaseMediaUploader extends SupabaseGateway
    implements MediaUploader {
  SupabaseMediaUploader(this._client);

  final SupabaseClient _client;

  @override
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  }) async {
    String? remotePath;
    try {
      return await _upload(
        bucket: bucket,
        localPath: localPath,
        fileName: fileName,
        onPath: (String path) => remotePath = path,
      );
    } on SupabaseFailure catch (failure) {
      // A 409 on a retry means an earlier attempt landed but its answer was
      // lost: the object is already there under this exact name.
      final MediaUploadResult? landed = alreadyUploadedResult(
        failure,
        bucket: bucket,
        remotePath: remotePath,
      );
      if (landed != null) return landed;
      rethrow;
    }
  }

  Future<MediaUploadResult> _upload({
    required String bucket,
    required String localPath,
    required String fileName,
    required void Function(String path) onPath,
  }) {
    return guard(() async {
      final String remotePath = storageObjectPath(
        bucket: bucket,
        fileName: fileName,
        userId: _client.auth.currentUser?.id,
      );
      onPath(remotePath);
      await _client.storage.from(bucket).upload(
            remotePath,
            File(localPath),
            fileOptions: FileOptions(
              upsert: false,
              contentType: storageContentType(fileName),
            ),
          );
      return MediaUploadResult(
        remotePath: remotePath,
        remoteRef: 'tp-storage://$bucket/$remotePath',
      );
    });
  }
}

/// The result for an upload refused with 409 "already exists": every queued
/// object name is unique to one photo, so the object is that photo, stored by
/// an earlier attempt whose answer was lost. Null for any other failure.
@visibleForTesting
MediaUploadResult? alreadyUploadedResult(
  SupabaseFailure failure, {
  required String bucket,
  required String? remotePath,
}) {
  if (remotePath == null || remotePath.isEmpty) return null;
  if (failure.code != '409' &&
      failure.cause != SupabaseFailureCause.uniqueViolation) {
    return null;
  }
  return MediaUploadResult(
    remotePath: remotePath,
    remoteRef: 'tp-storage://$bucket/$remotePath',
  );
}

/// Bucket of queued job completion photos.
const String workshopCompletionMediaBucket = 'tyre-photos';

/// File-name prefix that marks a queued photo as job completion evidence.
const String workshopCompletionMediaPrefix = 'jobdone_';

/// Bucket of queued wash and meter-log photos. The web app (`uploadWashPhoto`
/// in `src/lib/api/washRecords.js`) and the released phone app
/// (`uploadModulePhoto`) both write these to the private `tyre-photos`
/// bucket under `modules/<module>/<user>/`, and store `tp-storage://` refs.
const String moduleMediaBucket = 'tyre-photos';

/// File-name prefix that marks a queued photo as wash evidence
/// (`modules/wash/<user>/...`).
const String washMediaPrefix = 'washrec_';

/// File-name prefix that marks a queued photo as an odometer / engine-hours
/// gauge photo (`modules/meter-log/<user>/...`).
const String meterLogMediaPrefix = 'meterlog_';

/// Storage module folder per module-photo prefix.
const Map<String, String> _modulePhotoFolders = <String, String>{
  washMediaPrefix: 'wash',
  meterLogMediaPrefix: 'meter-log',
};

/// Builds the private Storage object path used by queued media uploads.
///
/// Accident evidence follows the production application's canonical
/// `accidents/<user>/<file>` namespace. Other established media buckets keep
/// their existing flat object names, so this correction cannot move or break
/// evidence written by the currently released application.
@visibleForTesting
String storageObjectPath({
  required String bucket,
  required String fileName,
  required String? userId,
}) {
  final String name = fileName.trim();
  if (name.isEmpty ||
      name == '.' ||
      name == '..' ||
      name.contains('/') ||
      name.contains('\\')) {
    throw ArgumentError.value(
      fileName,
      'fileName',
      'must be one safe basename',
    );
  }
  if (bucket == workshopCompletionMediaBucket &&
      name.startsWith(workshopCompletionMediaPrefix)) {
    // Job completion photos land where the workshop uploader puts them, so
    // `submit_job_completion` can check the object is the technician's own.
    final String owner = userId?.trim() ?? '';
    if (owner.isEmpty) {
      throw StateError(
        'Job completion photos cannot be uploaded without a signed-in owner.',
      );
    }
    final String ownerSegment =
        owner.length <= 8 ? owner : owner.substring(0, 8);
    return 'modules/workshop/$ownerSegment/$name';
  }
  if (bucket == moduleMediaBucket) {
    for (final MapEntry<String, String> module in _modulePhotoFolders.entries) {
      if (!name.startsWith(module.key)) continue;
      // Same namespace the web and the released app use, so web viewers
      // resolve these refs exactly like their own.
      final String owner = userId?.trim() ?? '';
      if (owner.isEmpty) {
        throw StateError(
          'Module photos cannot be uploaded without a signed-in owner.',
        );
      }
      final String ownerSegment =
          owner.length <= 8 ? owner : owner.substring(0, 8);
      return 'modules/${module.value}/$ownerSegment/$name';
    }
  }
  if (bucket != 'accident-photos') return name;

  final String owner = userId?.trim() ?? '';
  if (owner.isEmpty) {
    throw StateError(
      'Accident evidence cannot be uploaded without an authenticated owner.',
    );
  }
  final String ownerSegment = owner.length <= 8 ? owner : owner.substring(0, 8);
  return 'accidents/$ownerSegment/$name';
}

/// Explicit MIME metadata for every image type accepted by the live private
/// evidence buckets. Unknown extensions are left for Storage to infer.
@visibleForTesting
String? storageContentType(String fileName) {
  final String lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}
