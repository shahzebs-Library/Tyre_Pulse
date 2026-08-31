/// Resolves queued accident evidence immediately before the business row is
/// written.
///
/// Accident capture stores durable device paths in `pending_commands.photos`
/// and the uploaded private references in the related
/// `pending_media_uploads` rows. [SyncEngine] deliberately gives its
/// [CommandPusher] an allow-listed payload without knowing how individual
/// photo shapes are rebuilt. This production decorator joins those two local
/// records and lets PostgREST see only `tp-storage://accident-photos/...`
/// references.
///
/// Keeping this as a decorator also leaves every non-accident command exactly
/// as it was and avoids changing the protected queue/registry/engine wiring.
library;

import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';

final class AccidentEvidenceCommandPusher implements CommandPusher {
  const AccidentEvidenceCommandPusher({
    required CommandPusher delegate,
    required QueueDao queueDao,
    required MediaDao mediaDao,
  })  : _delegate = delegate,
        _queueDao = queueDao,
        _mediaDao = mediaDao;

  static const String _bucket = 'accident-photos';

  final CommandPusher _delegate;
  final QueueDao _queueDao;
  final MediaDao _mediaDao;

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    if (spec.type != CommandType.reportAccident) {
      return _delegate.push(
        spec: spec,
        payload: payload,
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      );
    }

    try {
      final _ResolvedAccidentEvidence resolved = await _resolve(payload);
      try {
        final List<Map<String, Object?>> rows = await _delegate.push(
          spec: spec,
          payload: resolved.payload,
          matchValue: matchValue,
          expectedPriorStatus: expectedPriorStatus,
        );
        await _mediaDao.markCommandMediaVerified(resolved.command.id);
        return rows;
      } on SupabaseFailure catch (failure) {
        // Match SyncEngine's idempotency judgement exactly. A 23505 on the
        // first attempt remains a genuine conflict; the same response after
        // an earlier attempt means that attempt landed and its evidence is
        // therefore safe to verify before SyncEngine marks the command synced.
        if (failure.isIdempotentReplay && resolved.command.retryCount > 0) {
          await _mediaDao.markCommandMediaVerified(resolved.command.id);
        }
        rethrow;
      }
    } on SupabaseFailure {
      rethrow;
    } on Object catch (error) {
      // CommandPusher's contract permits only SupabaseFailure. Local database
      // failures are intentionally wrapped in a safe sync error rather than
      // escaping and aborting the entire background pass as a raw exception.
      throw _evidenceFailure(
        'The local accident evidence state could not be resolved.',
        cause: error,
      );
    }
  }

  Future<_ResolvedAccidentEvidence> _resolve(
    Map<String, Object?> payload,
  ) async {
    final Object? rawClientUuid = payload['client_uuid'];
    if (rawClientUuid is! String || rawClientUuid.trim().isEmpty) {
      throw _evidenceFailure(
        'The accident command has no usable client identity.',
      );
    }

    final PendingCommand? command =
        await _queueDao.commandByIdempotencyKey(rawClientUuid);
    if (command == null ||
        command.commandType != CommandType.reportAccident.wireName) {
      throw _evidenceFailure(
        'The accident command could not be matched to its local queue row.',
      );
    }

    final List<PendingMediaUpload> media =
        await _mediaDao.mediaForCommand(command.id);
    final Object? rawPhotos = payload['photos'];
    if (rawPhotos == null) {
      if (media.isNotEmpty) {
        throw _evidenceFailure(
          'The accident has queued evidence that is absent from its payload.',
        );
      }
      return _ResolvedAccidentEvidence(
        command: command,
        payload: Map<String, Object?>.of(payload),
      );
    }
    if (rawPhotos is! List<Object?>) {
      throw _evidenceFailure(
        'The accident evidence payload is not a flat photo list.',
      );
    }

    final Set<String> consumedMediaIds = <String>{};
    final List<String> resolvedPhotos = <String>[];
    for (final Object? value in rawPhotos) {
      if (value is! String || value.isEmpty) {
        throw _evidenceFailure(
          'The accident evidence payload contains an invalid reference.',
        );
      }

      final PrivateStorageReference? existing =
          PrivateStorageReference.tryParse(value);
      if (existing != null) {
        if (existing.bucket != _bucket) {
          throw _evidenceFailure(
            'The accident evidence points at an unexpected private bucket.',
          );
        }
        final PendingMediaUpload? matching = _singleUnused(
          media,
          consumedMediaIds,
          (PendingMediaUpload row) => row.remoteRef == value,
        );
        if (matching != null) {
          _validateUploaded(matching);
          consumedMediaIds.add(matching.id);
        }
        resolvedPhotos.add(value);
        continue;
      }

      final PendingMediaUpload? matching = _singleUnused(
        media,
        consumedMediaIds,
        (PendingMediaUpload row) => row.localPath == value,
      );
      if (matching == null) {
        throw _evidenceFailure(
          'A local accident evidence path has no matching media row.',
        );
      }
      final String remoteRef = _validateUploaded(matching);
      consumedMediaIds.add(matching.id);
      resolvedPhotos.add(remoteRef);
    }

    if (consumedMediaIds.length != media.length) {
      throw _evidenceFailure(
        'The accident media rows do not match its evidence payload one-to-one.',
      );
    }

    return _ResolvedAccidentEvidence(
      command: command,
      payload: <String, Object?>{
        ...payload,
        'photos': List<String>.unmodifiable(resolvedPhotos),
      },
    );
  }

  PendingMediaUpload? _singleUnused(
    List<PendingMediaUpload> media,
    Set<String> consumed,
    bool Function(PendingMediaUpload row) matches,
  ) {
    PendingMediaUpload? result;
    for (final PendingMediaUpload row in media) {
      if (consumed.contains(row.id) || !matches(row)) continue;
      if (result != null) {
        throw _evidenceFailure(
          'More than one media row matches the same accident evidence item.',
        );
      }
      result = row;
    }
    return result;
  }

  String _validateUploaded(PendingMediaUpload media) {
    if (media.state != MediaUploadState.uploaded &&
        media.state != MediaUploadState.verified) {
      throw _evidenceFailure(
        'The accident evidence has not finished uploading.',
      );
    }
    if (media.bucket != _bucket) {
      throw _evidenceFailure(
        'The accident media row has an unexpected private bucket.',
      );
    }

    final String? remoteRef = media.remoteRef;
    final String? remotePath = media.remotePath;
    final PrivateStorageReference? parsed =
        remoteRef == null ? null : PrivateStorageReference.tryParse(remoteRef);
    if (parsed == null ||
        parsed.bucket != _bucket ||
        remotePath == null ||
        remotePath.isEmpty ||
        parsed.path != remotePath) {
      throw _evidenceFailure(
        'The uploaded accident evidence has no valid private reference.',
      );
    }
    return remoteRef!;
  }
}

final class _ResolvedAccidentEvidence {
  const _ResolvedAccidentEvidence({
    required this.command,
    required this.payload,
  });

  final PendingCommand command;
  final Map<String, Object?> payload;
}

SupabaseFailure _evidenceFailure(String technical, {Object? cause}) {
  return SupabaseFailure(
    error: AppError(
      kind: AppErrorKind.sync,
      message: 'This accident report could not send its evidence safely. '
          'It remains on this device and needs attention.',
      technical: technical,
      cause: cause,
      isRetryable: true,
    ),
    cause: SupabaseFailureCause.unknown,
    rawMessage: technical,
  );
}
