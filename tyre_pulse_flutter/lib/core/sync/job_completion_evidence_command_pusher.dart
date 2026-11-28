/// Resolves a queued job completion's photos immediately before the
/// `submit_job_completion` RPC is called.
///
/// The technician's phone may be offline when the job is finished, so the
/// completion sheet queues the before / after photos as media attachments of
/// the `JOB_COMPLETION` command (bucket `tyre-photos`, field key `before` /
/// `after`), and the payload keeps their durable local paths. The command's
/// spec has `requiresMediaReady`, so [SyncEngine] only pushes it after every
/// photo reached the server. This decorator then swaps each local path for
/// that photo's uploaded `tp-storage://tyre-photos/modules/workshop/...`
/// reference, so the server never sees a device path.
///
/// Same pattern as `AccidentEvidenceCommandPusher`; every other command
/// passes straight through.
library;

import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart'
    show workshopCompletionMediaBucket;
import 'package:tyre_pulse/core/sync/sync_engine.dart';

/// Payload field -> media field key.
const Map<String, String> kJobCompletionPhotoFields = <String, String>{
  'before_photos': 'before',
  'after_photos': 'after',
};

final class JobCompletionEvidenceCommandPusher implements CommandPusher {
  const JobCompletionEvidenceCommandPusher({
    required CommandPusher delegate,
    required QueueDao queueDao,
    required MediaDao mediaDao,
  })  : _delegate = delegate,
        _queueDao = queueDao,
        _mediaDao = mediaDao;

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
    if (spec.type != CommandType.jobCompletion) {
      return _delegate.push(
        spec: spec,
        payload: payload,
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      );
    }
    final Map<String, Object?> resolved;
    try {
      resolved = await _resolve(payload);
    } on SupabaseFailure {
      rethrow;
    } on Object catch (error) {
      throw _failure(
        'The local job completion photos could not be resolved.',
        cause: error,
      );
    }
    return _delegate.push(
      spec: spec,
      payload: resolved,
      matchValue: matchValue,
      expectedPriorStatus: expectedPriorStatus,
    );
  }

  Future<Map<String, Object?>> _resolve(Map<String, Object?> payload) async {
    final Object? key = payload['client_uuid'];
    if (key is! String || key.trim().isEmpty) {
      throw _failure('The job completion has no usable client identity.');
    }
    final PendingCommand? command =
        await _queueDao.commandByIdempotencyKey(key);
    if (command == null ||
        command.commandType != CommandType.jobCompletion.wireName) {
      throw _failure('The job completion has no matching local queue row.');
    }
    final List<PendingMediaUpload> media =
        await _mediaDao.mediaForCommand(command.id);
    final Set<String> consumed = <String>{};
    final Map<String, Object?> out = Map<String, Object?>.of(payload);

    for (final MapEntry<String, String> field
        in kJobCompletionPhotoFields.entries) {
      final Object? raw = payload[field.key];
      if (raw == null) {
        out[field.key] = const <String>[];
        continue;
      }
      if (raw is! List<Object?>) {
        throw _failure('A job completion photo field is not a list.');
      }
      final List<String> refs = <String>[];
      for (final Object? value in raw) {
        if (value is! String || value.isEmpty) {
          throw _failure('A job completion photo entry is invalid.');
        }
        final PrivateStorageReference? existing =
            PrivateStorageReference.tryParse(value);
        if (existing != null) {
          if (existing.bucket != workshopCompletionMediaBucket) {
            throw _failure(
              'A job completion photo is in an unexpected bucket.',
            );
          }
          refs.add(value);
          continue;
        }
        PendingMediaUpload? match;
        for (final PendingMediaUpload row in media) {
          if (consumed.contains(row.id) || row.localPath != value) continue;
          if (row.fieldKey != null && row.fieldKey != field.value) continue;
          match = row;
          break;
        }
        if (match == null) {
          throw _failure('A local job completion photo has no media row.');
        }
        refs.add(_uploadedRef(match));
        consumed.add(match.id);
      }
      out[field.key] = List<String>.unmodifiable(refs);
    }
    return out;
  }

  String _uploadedRef(PendingMediaUpload media) {
    if (media.state != MediaUploadState.uploaded &&
        media.state != MediaUploadState.verified) {
      throw _failure('A job completion photo has not finished uploading.');
    }
    final String? ref = media.remoteRef;
    final PrivateStorageReference? parsed =
        ref == null ? null : PrivateStorageReference.tryParse(ref);
    if (parsed == null ||
        parsed.bucket != workshopCompletionMediaBucket ||
        media.bucket != workshopCompletionMediaBucket ||
        parsed.path != media.remotePath) {
      throw _failure(
        'An uploaded job completion photo has no valid reference.',
      );
    }
    return ref!;
  }
}

SupabaseFailure _failure(String technical, {Object? cause}) => SupabaseFailure(
      error: AppError(
        kind: AppErrorKind.sync,
        message: 'This job completion could not send its photos safely. '
            'It stays on this phone and will try again.',
        technical: technical,
        cause: cause,
        isRetryable: true,
      ),
      cause: SupabaseFailureCause.unknown,
      rawMessage: technical,
    );
