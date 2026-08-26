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

import 'package:supabase_flutter/supabase_flutter.dart';
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
      if (spec.operation == CommandOperation.insert) {
        // A plain insert, never `.upsert()`. See `sync_engine.dart`'s
        // library comment for why: several of the idempotent tables use a
        // PARTIAL unique index on `client_uuid`, which PostgREST's
        // `on_conflict` parameter cannot supply the predicate for, so an
        // upsert can fail with 42P10 even when the row already exists. A
        // plain insert enforces the same uniqueness correctly regardless,
        // and throws 23505 on a genuine duplicate for `SyncEngine` to
        // classify against the command's own retry count.
        final List<Map<String, dynamic>> rows = await _client
            .from(spec.table)
            .insert(payload)
            .select();
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

      var query = _client
          .from(spec.table)
          .update(payload)
          .eq(matchColumn, matchValue);

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
  }) {
    return guard(() async {
      // `fileName` already carries its own uniqueness - a unique index on
      // `pending_media_uploads.fileName` - so it is used directly as the
      // storage object path, with no extra folder structure invented here.
      await _client.storage.from(bucket).upload(fileName, File(localPath));
      return MediaUploadResult(
        remotePath: fileName,
        remoteRef: 'tp-storage://$bucket/$fileName',
      );
    });
  }
}
