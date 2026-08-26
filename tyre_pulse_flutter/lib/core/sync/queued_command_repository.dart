/// The write-side API a feature screen calls to enqueue an offline command.
///
/// This is the ONLY place in the application that constructs a
/// `pending_commands` row. A screen that wants to capture a tyre change, a
/// meter reading, an accident report or any other queueable write calls
/// [QueuedCommandRepository.enqueue] with a [CommandType] and a raw payload;
/// it never calls `QueueDao.enqueue` directly and never chooses a table name
/// itself.
///
/// What this file does NOT do, deliberately: it does not attempt an online
/// write first, does not retry, does not push anything to the server, and
/// does not resolve photo attachments. Pushing a claimed command to Supabase
/// is `sync_engine.dart`'s job, a separate, concurrently-developed piece of
/// this same `lib/core/sync/` package. This file's only responsibility is
/// getting a command durably and correctly INTO the local queue.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// What happened when a command was enqueued.
final class EnqueueResult {
  const EnqueueResult({
    required this.command,
    required this.droppedFields,
  });

  /// The row as it now stands in `pending_commands`.
  final PendingCommand command;

  /// Field names present in the caller's payload but absent from the
  /// command's [CommandSpec.fieldAllowList], and therefore silently dropped
  /// before the payload was stored.
  ///
  /// Non-empty is worth logging as telemetry, never as a user-facing error:
  /// it usually means a screen is sending a field the registry does not yet
  /// know about, and the write still succeeds with the fields that ARE
  /// allow-listed. A column PostgREST cannot find fails the whole request,
  /// which is precisely the failure this drop exists to prevent.
  final Set<String> droppedFields;
}

/// Enqueues offline commands. See the library comment.
final class QueuedCommandRepository {
  const QueuedCommandRepository(this._queueDao);

  final QueueDao _queueDao;

  /// Enqueues one command for [workspace].
  ///
  /// [payload] is filtered down to [CommandSpec.fieldAllowList] before it is
  /// stored; keys that survive the filter are reported back on
  /// [EnqueueResult.droppedFields] and the ones that were kept are what
  /// becomes `pending_commands.payloadJson`.
  ///
  /// [entityId] is the row an UPDATE command targets, and is required
  /// whenever [CommandSpec.operation] is [CommandOperation.update] - an
  /// update command with no target row is a caller bug (there is nothing to
  /// patch), so a missing or blank [entityId] throws [ArgumentError] rather
  /// than silently queuing a command that can never be applied. It is passed
  /// through unchanged for an insert command, where it plays no role in the
  /// write but may still be useful to a caller building a `dependsOn` chain
  /// against a not-yet-synced predecessor's local id.
  ///
  /// [country] is stored on its own `pending_commands.country` column - see
  /// `sync_workspace_id.dart` for why that must never be folded into
  /// `workspaceId`. When the caller does not supply one, this falls back to
  /// [WorkspaceContext.activeCountry]: the command was captured while that
  /// country was the one selected in the app, and recording it is more
  /// useful to a later diagnostic than leaving the column null. A caller
  /// that genuinely captured country-independent data may still pass
  /// `country: null` explicitly - there is no way to distinguish "not
  /// supplied" from "explicitly null" through a nullable named parameter, so
  /// this fallback is a default, not a requirement; a screen that must
  /// record no country regardless of the active selection should not rely on
  /// omitting the argument.
  ///
  /// [id] and [idempotencyKey] are optional pass-throughs to
  /// `QueueDao.enqueue`. When neither is supplied, `QueueDao` mints both
  /// itself (a fresh UUID for each) - this repository never invents an id or
  /// a key on its own, so there is exactly one place in the codebase that
  /// decides how an id is minted when the caller has no reason to control
  /// it.
  Future<EnqueueResult> enqueue({
    required CommandType type,
    required Map<String, Object?> payload,
    required WorkspaceContext workspace,
    required DateTime now,
    String? entityId,
    String? dependsOn,
    List<QueuedMediaAttachment> attachments = const <QueuedMediaAttachment>[],
    String? country,
    String? id,
    String? idempotencyKey,
  }) async {
    final CommandSpec spec = CommandRegistry.specFor(type);

    final String? trimmedEntityId = entityId?.trim();
    final bool hasEntityId =
        trimmedEntityId != null && trimmedEntityId.isNotEmpty;
    if (spec.operation == CommandOperation.update && !hasEntityId) {
      throw ArgumentError.value(
        entityId,
        'entityId',
        'is required for the update command ${spec.type.wireName}: an '
            'update with no target row is a caller bug, not a runtime '
            'condition to queue blindly.',
      );
    }

    final Map<String, Object?> filtered = <String, Object?>{};
    final Set<String> dropped = <String>{};
    for (final MapEntry<String, Object?> entry in payload.entries) {
      if (spec.fieldAllowList.contains(entry.key)) {
        filtered[entry.key] = entry.value;
      } else {
        dropped.add(entry.key);
      }
    }

    final String workspaceId = workspaceIdFor(workspace);
    final String? resolvedCountry = country ?? workspace.activeCountry;

    final PendingCommand command = await _queueDao.enqueue(
      commandType: spec.type.wireName,
      entityType: spec.table,
      payloadJson: jsonEncode(filtered),
      createdBy: workspace.userId,
      workspaceId: workspaceId,
      now: now,
      id: id,
      idempotencyKey: idempotencyKey,
      entityId: entityId,
      country: resolvedCountry,
      dependsOn: dependsOn,
      attachments: attachments,
    );

    return EnqueueResult(
      command: command,
      droppedFields: Set<String>.unmodifiable(dropped),
    );
  }
}
