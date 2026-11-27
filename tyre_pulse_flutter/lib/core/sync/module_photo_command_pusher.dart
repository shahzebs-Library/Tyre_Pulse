/// Resolves the photos of a queued wash record or meter reading immediately
/// before its row is inserted.
///
/// `WASH_RECORD`, `ODOMETER_LOG` and `ENGINE_HOURS_LOG` queue their photos as
/// media attachments (bucket `tyre-photos`, file names `washrec_...` /
/// `meterlog_...`, so they land under `modules/wash/<user>/` and
/// `modules/meter-log/<user>/` exactly where the web app and the released
/// phone app put them). The payload keeps the durable local paths; this
/// decorator swaps each one for its uploaded `tp-storage://` reference, so a
/// device path never reaches `wash_records.photos`, `odometer_logs.photos` or
/// `engine_hours_logs.photos`.
///
/// Unlike job completion, these commands are NOT `requiresMediaReady`: a
/// photo must never hold the record back for good. So:
///
/// - a photo that already uploaded is sent as its reference;
/// - a photo still waiting is uploaded by the drain, one try per sync; the
///   record waits for it (no connection, 5xx, 429, an expired session) for
///   up to [kModulePhotoWaitCap] syncs, then goes out without it with a
///   visible reason;
/// - a photo the server refuses for good (403, 413, 400, missing bucket) is
///   marked abandoned with a visible reason and the record goes without it;
/// - a photo whose local file is gone is marked abandoned with a reason
///   and the record is sent without it;
/// - a photo an older build queued with no upload destination is given one
///   (same bucket and namespace) and uploaded like a new one.
///
/// Every other command passes straight through.
library;

import 'dart:io';

import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart'
    show meterLogMediaPrefix, moduleMediaBucket, washMediaPrefix;
import 'package:tyre_pulse/core/sync/sync_engine.dart';

/// File-name prefix per command whose photos this decorator resolves.
const Map<CommandType, String> kModulePhotoPrefixes = <CommandType, String>{
  CommandType.washRecord: washMediaPrefix,
  CommandType.odometerLog: meterLogMediaPrefix,
  CommandType.engineHoursLog: meterLogMediaPrefix,
};

/// The visible reason left on a photo whose file disappeared.
const String kModulePhotoMissingMessage =
    'This photo is no longer on this phone, so the record was sent without it.';

/// The visible reason left on a photo the server refused.
const String kModulePhotoRefusedMessage =
    'The server refused this photo, so the record was sent without it.';

/// The visible reason left on a photo that kept failing until the cap.
const String kModulePhotoTimedOutMessage =
    'This photo could not be uploaded in time, so the record was sent '
    'without it.';

/// The upload object name for a module photo: prefix + a unique part + the
/// local basename. Safe as one storage basename.
String modulePhotoFileName({
  required String prefix,
  required String unique,
  required String localName,
}) {
  final String safe = localName.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  final String u = unique.replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
  final String head = u.length <= 8 ? u : u.substring(0, 8);
  return '$prefix${head}_${safe.isEmpty ? 'photo.jpg' : safe}';
}

bool _defaultFileExists(String path) => File(path).existsSync();

final class ModulePhotoCommandPusher implements CommandPusher {
  const ModulePhotoCommandPusher({
    required CommandPusher delegate,
    required QueueDao queueDao,
    required MediaDao mediaDao,
    required MediaUploader uploader,
    bool Function(String path) fileExists = _defaultFileExists,
    DateTime Function()? clock,
  })  : _delegate = delegate,
        _queueDao = queueDao,
        _mediaDao = mediaDao,
        _uploader = uploader,
        _fileExists = fileExists,
        _clock = clock;

  final CommandPusher _delegate;
  final QueueDao _queueDao;
  final MediaDao _mediaDao;
  final MediaUploader _uploader;
  final bool Function(String path) _fileExists;
  final DateTime Function()? _clock;

  DateTime _now() => (_clock ?? DateTime.now)().toUtc();

  @override
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  }) async {
    final String? prefix = kModulePhotoPrefixes[spec.type];
    if (prefix == null) {
      return _delegate.push(
        spec: spec,
        payload: payload,
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      );
    }

    final PendingCommand? command = await _commandFor(spec, payload);
    final Map<String, Object?> resolved;
    try {
      resolved = await _resolve(payload, command, prefix);
    } on SupabaseFailure {
      rethrow;
    } on Object catch (error) {
      throw _failure(
        'The local photos of this record could not be resolved.',
        cause: error,
      );
    }

    final List<Map<String, Object?>> rows;
    try {
      rows = await _delegate.push(
        spec: spec,
        payload: resolved,
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      );
    } on SupabaseFailure catch (failure) {
      // A lost-response replay: the engine will mark the command synced, so
      // its photos must be final too or the queue never prunes it.
      if (command != null &&
          command.retryCount > 0 &&
          isClientUuidReplay(failure)) {
        await _mediaDao.markCommandMediaVerified(command.id);
      }
      rethrow;
    }
    // The row now carries the references, so the uploaded copies are
    // delivered and the local files may be cleaned up with the command.
    if (command != null) {
      await _mediaDao.markCommandMediaVerified(command.id);
    }
    return rows;
  }

  Future<PendingCommand?> _commandFor(
    CommandSpec spec,
    Map<String, Object?> payload,
  ) async {
    final Object? key = payload['client_uuid'];
    if (key is! String || key.trim().isEmpty) return null;
    final PendingCommand? command =
        await _queueDao.commandByIdempotencyKey(key);
    if (command == null || command.commandType != spec.type.wireName) {
      return null;
    }
    return command;
  }

  Future<Map<String, Object?>> _resolve(
    Map<String, Object?> payload,
    PendingCommand? command,
    String prefix,
  ) async {
    final Map<String, Object?> out = Map<String, Object?>.of(payload);
    final Object? raw = payload['photos'];
    if (raw == null) return out;
    if (raw is! List<Object?>) {
      // Never send something that is not a list of references.
      out['photos'] = null;
      return out;
    }
    final List<PendingMediaUpload> media = command == null
        ? const <PendingMediaUpload>[]
        : await _mediaDao.mediaForCommand(command.id);
    final Set<String> consumed = <String>{};
    final List<String> refs = <String>[];

    for (final Object? value in raw) {
      if (value is! String || value.trim().isEmpty) continue;
      final PrivateStorageReference? existing =
          PrivateStorageReference.tryParse(value);
      if (existing != null) {
        refs.add(value);
        continue;
      }
      PendingMediaUpload? match;
      for (final PendingMediaUpload row in media) {
        if (consumed.contains(row.id) || row.localPath != value) continue;
        match = row;
        break;
      }
      // A local path with no media row can never be uploaded: drop it rather
      // than write a device path to the server.
      if (match == null) continue;
      consumed.add(match.id);
      final String? ref = await _refFor(
        match,
        prefix,
        atCap: (command?.retryCount ?? 0) >= kModulePhotoWaitCap,
      );
      if (ref != null) refs.add(ref);
    }

    out['photos'] = refs.isEmpty ? null : List<String>.unmodifiable(refs);
    return out;
  }

  /// The uploaded reference for [media], or null when the record should be
  /// sent without this photo. Throws a retryable failure when the record
  /// should wait for the photo.
  ///
  /// The drain uploads queued photos (one try per sync). This method only
  /// uploads a photo itself when the drain cannot: it has no destination yet
  /// (an older build), its attempt budget is spent, or the record has waited
  /// [kModulePhotoWaitCap] syncs ([atCap]). It never counts an attempt, so a
  /// transient error cannot spend a photo's budget.
  Future<String?> _refFor(
    PendingMediaUpload media,
    String prefix, {
    required bool atCap,
  }) async {
    if (media.state == MediaUploadState.uploaded ||
        media.state == MediaUploadState.verified) {
      final String? ref = media.remoteRef;
      if (ref != null && PrivateStorageReference.tryParse(ref) != null) {
        return ref;
      }
      return null;
    }
    if (media.state == MediaUploadState.abandoned) return null;

    if (!_fileExists(media.localPath)) {
      await _mediaDao.abandonMedia(
        media.id,
        messageSafe: kModulePhotoMissingMessage,
      );
      return null;
    }

    final bool unrouted = media.bucket == null || media.bucket!.isEmpty;
    final bool spent = media.state == MediaUploadState.failed;
    if (!unrouted && !spent && !atCap) throw _waiting();

    String bucket = media.bucket ?? '';
    String fileName = media.fileName;
    if (unrouted) {
      bucket = moduleMediaBucket;
      fileName = modulePhotoFileName(
        prefix: prefix,
        unique: media.id,
        localName: media.fileName,
      );
      await _mediaDao.routeUnroutedMedia(
        media.id,
        bucket: bucket,
        fileName: fileName,
      );
    }

    try {
      final MediaUploadResult result = await _uploader.upload(
        bucket: bucket,
        localPath: media.localPath,
        fileName: fileName,
      );
      await _mediaDao.markUploaded(
        media.id,
        bucket: bucket,
        remotePath: result.remotePath,
        remoteRef: result.remoteRef,
        at: _now(),
      );
      return result.remoteRef;
    } on SupabaseFailure catch (failure) {
      if (isDefinitivePhotoRefusal(failure)) {
        await _mediaDao.abandonMedia(
          media.id,
          messageSafe: kModulePhotoRefusedMessage,
        );
        return null;
      }
      // Transient (no connection, 5xx, 429, an expired session): keep the
      // photo and wait, until the record has waited long enough.
      if (atCap && !isConnectivityFailure(failure)) {
        await _mediaDao.abandonMedia(
          media.id,
          messageSafe: kModulePhotoTimedOutMessage,
        );
        return null;
      }
      throw _waiting(cause: failure);
    }
  }
}

/// How many syncs a record waits for a photo that keeps failing for a
/// transient reason before it is sent without it. Below the queue's own
/// retry limit, so the record itself is never dead-lettered for a photo.
const int kModulePhotoWaitCap = 5;

/// A refusal that will not change on retry: forbidden, too large, invalid,
/// or the destination does not exist.
bool isDefinitivePhotoRefusal(SupabaseFailure failure) {
  switch (failure.code) {
    case '400':
    case '403':
    case '404':
    case '413':
      return true;
  }
  switch (failure.cause) {
    case SupabaseFailureCause.forbidden:
    case SupabaseFailureCause.rowLevelSecurity:
    case SupabaseFailureCause.checkViolation:
    case SupabaseFailureCause.invalidInput:
    case SupabaseFailureCause.storageNotFound:
      return true;
    default:
      return false;
  }
}

/// No usable connection: nothing can be learned about the photo, and the
/// record could not be written either.
bool isConnectivityFailure(SupabaseFailure failure) =>
    failure.cause == SupabaseFailureCause.offline ||
    failure.cause == SupabaseFailureCause.timeout;

SupabaseFailure _waiting({Object? cause}) => _failure(
      'A photo of this record has not finished uploading.',
      cause: cause,
    );

SupabaseFailure _failure(String technical, {Object? cause}) => SupabaseFailure(
      error: AppError(
        kind: AppErrorKind.sync,
        message: 'This record is waiting for its photos to upload. '
            'It stays on this phone and will try again.',
        technical: technical,
        cause: cause,
        isRetryable: true,
      ),
      cause: SupabaseFailureCause.unknown,
      rawMessage: technical,
    );
