/// Reads and writes for photos and signatures.
///
/// Two folders, two tables, two lifecycles - and one sweep that checks BOTH
/// before it deletes anything.
///
/// The recorded trap: the React Native sweep builds a set of every durable path
/// referenced by a non-synced QUEUE entry, then deletes every file in the queue
/// folder whose basename is not in that set, after EVERY sync and on app start.
/// A DRAFT is not a queue entry. A previous attempt at draft photos wrote them
/// into the queue folder and had to be reverted, because the next sync - which
/// may be seconds later - found them referenced by nothing and deleted the
/// operator's evidence, turning a likely loss into a certain one.
///
/// Artifact 05 answers that with two folders. This DAO adds a second belt:
/// [orphanFileNames] consults the queue table AND the draft table, so even a
/// file that somehow landed in the wrong folder cannot be deleted while it is
/// still somebody's evidence. Dropping either half of that check is what the
/// media DAO test exists to catch.
library;

import 'dart:convert';
import 'dart:math' as math;

import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/tables/draft_tables.dart';
import 'package:tyre_pulse/core/database/tables/queue_tables.dart';
import 'package:uuid/uuid.dart';

part 'media_dao.g.dart';

/// Queue media, draft media and captured signatures.
@DriftAccessor(
  tables: <Type>[PendingMediaUploads, DraftPhotos, CapturedSignatures],
)
class MediaDao extends DatabaseAccessor<AppDatabase> with _$MediaDaoMixin {
  MediaDao(super.attachedDatabase);

  static const Uuid _uuid = Uuid();

  /// SQLite's default bound-variable limit is 999. Chunk below it so a sweep of
  /// a large media folder cannot fail on the query itself.
  static const int _inClauseChunk = 400;

  // -- Queue media ----------------------------------------------------------

  Future<List<PendingMediaUpload>> mediaForCommand(String commandId) {
    return (select(pendingMediaUploads)
          ..where((t) => t.commandId.equals(commandId))
          ..orderBy([
            (t) => OrderingTerm.asc(t.fieldKey),
            (t) => OrderingTerm.asc(t.orderIndex),
          ]))
        .get();
  }

  /// Claims work for the uploader, bounded by [uploadConcurrency].
  ///
  /// The bound is not a tuning preference. A fan-out over every tyre position
  /// decoded one full-size bitmap per tyre at once - 13 on a Tr-Mixer, roughly
  /// 600 MB peak - which is a hard native out-of-memory crash on the 2 GB
  /// handsets this fleet uses. The inspector lost the work with no error and
  /// the queue then replayed the crash.
  ///
  /// A row that has already reached [maxUploadAttempts] is not claimed again;
  /// it is reported instead of retried into the same crash loop.
  ///
  /// [excludeIds] are skipped: photos already tried this pass, and photos
  /// still inside their transient backoff. Without it a failing photo at the
  /// head of the queue is claimed again and again and hides the rest.
  Future<List<PendingMediaUpload>> claimNextUploads({
    int limit = uploadConcurrency,
    String? workspaceId,
    String? createdBy,
    Iterable<String> excludeIds = const <String>[],
  }) async {
    final Set<String> excludeSet = excludeIds.toSet();
    // Small sets go into the SQL; a large one (many photos waiting out a
    // backoff) would pass SQLite's bound-variable limit, so it is filtered
    // here instead.
    final bool inSql = excludeSet.length <= _inClauseChunk;
    final List<String> exclude =
        inSql ? excludeSet.toList(growable: false) : const <String>[];
    return transaction(() async {
      final commands = attachedDatabase.pendingCommands;
      final owners = selectOnly(commands)..addColumns([commands.id]);
      if (workspaceId != null) {
        owners.where(commands.workspaceId.equals(workspaceId));
      }
      if (createdBy != null) {
        owners.where(commands.createdBy.equals(createdBy));
      }
      final due = await (select(pendingMediaUploads)
            ..where(
              (t) =>
                  t.state.equals(MediaUploadState.queued) &
                  t.attempts.isSmallerThanValue(maxUploadAttempts) &
                  t.commandId.isInQuery(owners) &
                  (exclude.isEmpty
                      ? const Constant<bool>(true)
                      : t.id.isNotIn(exclude)),
            )
            ..orderBy([
              (t) => OrderingTerm.asc(t.capturedAt),
              (t) => OrderingTerm.asc(t.id),
            ])
            ..limit(inSql ? limit : limit + excludeSet.length))
          .get();

      final claimed = <PendingMediaUpload>[];
      for (final PendingMediaUpload row in due
          .where((PendingMediaUpload r) => !excludeSet.contains(r.id))
          .take(limit)) {
        await (update(
          pendingMediaUploads,
        )..where((t) => t.id.equals(row.id)))
            .write(
          const PendingMediaUploadsCompanion(
            state: Value<String>(MediaUploadState.uploading),
          ),
        );
        claimed.add(
          await (select(pendingMediaUploads)
                ..where((t) => t.id.equals(row.id))
                ..limit(1))
              .getSingle(),
        );
      }
      return claimed;
    });
  }

  /// Storage accepted the object.
  ///
  /// This is NOT far enough to delete the local file. An object in a bucket
  /// that no database row references is unreachable; the photo is only
  /// delivered once the business row carrying its reference has committed.
  Future<void> markUploaded(
    String id, {
    required String bucket,
    required String remotePath,
    required String remoteRef,
    required DateTime at,
  }) async {
    await (update(pendingMediaUploads)..where((t) => t.id.equals(id))).write(
      PendingMediaUploadsCompanion(
        state: const Value<String>(MediaUploadState.uploaded),
        bucket: Value<String?>(bucket),
        remotePath: Value<String?>(remotePath),
        remoteRef: Value<String?>(remoteRef),
        uploadedAt: Value<DateTime?>(at),
        lastError: const Value<String?>(null),
      ),
    );
    await clearUploadBackoff(id);
  }

  /// The owning command reached `synced` carrying these references. Only now is
  /// the local file safe to remove.
  Future<int> markCommandMediaVerified(String commandId) {
    return (update(pendingMediaUploads)
          ..where(
            (t) =>
                t.commandId.equals(commandId) &
                t.state.equals(MediaUploadState.uploaded),
          ))
        .write(
      const PendingMediaUploadsCompanion(
        state: Value<String>(MediaUploadState.verified),
      ),
    );
  }

  /// Records a failed upload attempt.
  ///
  /// [messageSafe] must already be sanitised; a raw driver message stored here
  /// leaks later through a log export.
  ///
  /// With [now] the photo also backs off, so a refusal still under its
  /// budget is not retried every single pass.
  Future<PendingMediaUpload> markUploadAttemptFailed(
    String id, {
    required String messageSafe,
    DateTime? now,
  }) async {
    return transaction(() async {
      if (now != null) await _bumpBackoff(id, now: now, authLapse: false);
      final PendingMediaUpload current = await (select(pendingMediaUploads)
            ..where((t) => t.id.equals(id))
            ..limit(1))
          .getSingle();
      final int attempts = current.attempts + 1;
      final bool exhausted = attempts >= maxUploadAttempts;

      await (update(pendingMediaUploads)..where((t) => t.id.equals(id))).write(
        PendingMediaUploadsCompanion(
          attempts: Value<int>(attempts),
          state: Value<String>(
            exhausted ? MediaUploadState.failed : MediaUploadState.queued,
          ),
          lastError: Value<String?>(messageSafe),
        ),
      );

      return (select(pendingMediaUploads)
            ..where((t) => t.id.equals(id))
            ..limit(1))
          .getSingle();
    });
  }

  /// Gives a queued photo that was stored with no upload destination (an
  /// older build queued wash / meter-log photos without a bucket) its
  /// destination, and makes it eligible for upload again.
  ///
  /// Only rows still missing a bucket are touched, so a row can be re-routed
  /// once and never loops back to a fresh attempt budget.
  Future<int> routeUnroutedMedia(
    String id, {
    required String bucket,
    required String fileName,
  }) {
    return (update(pendingMediaUploads)
          ..where((t) => t.id.equals(id) & t.bucket.isNull()))
        .write(
      PendingMediaUploadsCompanion(
        bucket: Value<String?>(bucket),
        fileName: Value<String>(fileName),
        state: const Value<String>(MediaUploadState.queued),
        attempts: const Value<int>(0),
        lastError: const Value<String?>(null),
      ),
    );
  }

  /// Gives up on a queued photo for good (its file is gone, the server
  /// refused it, or it could not upload in time), keeping [messageSafe] as
  /// the visible reason. [MediaUploadState.abandoned] is final, so the
  /// queue can prune the record once it is synced without this photo.
  Future<void> abandonMedia(String id, {required String messageSafe}) async {
    await (update(pendingMediaUploads)..where((t) => t.id.equals(id))).write(
      PendingMediaUploadsCompanion(
        state: const Value<String>(MediaUploadState.abandoned),
        attempts: const Value<int>(maxUploadAttempts),
        lastError: Value<String?>(messageSafe),
      ),
    );
    await clearUploadBackoff(id);
  }

  // -- Transient failures and backoff -------------------------------------

  /// First wait after a failed upload; doubles per consecutive failure up to
  /// [transientBackoffMax].
  static const Duration transientBackoffBase = Duration(seconds: 30);
  static const Duration transientBackoffMax = Duration(minutes: 15);

  /// Records an upload failure that may clear on its own (no signal, 5xx,
  /// 429, a lapsed session). It does NOT count an attempt: the photo goes
  /// back to `queued`, keeps [messageSafe] as its visible reason, and waits
  /// a growing backoff before the next try. A record that needs this photo
  /// is never failed or abandoned for a passing reason.
  ///
  /// The backoff lives in `sync_metadata` because the engine is rebuilt for
  /// every sync run.
  Future<void> recordTransientUploadFailure(
    String id, {
    required String messageSafe,
    required DateTime now,
    bool authLapse = false,
  }) async {
    await transaction(() async {
      await (update(pendingMediaUploads)
            ..where(
              (t) =>
                  t.id.equals(id) &
                  t.state.isIn(<String>[
                    MediaUploadState.uploading,
                    MediaUploadState.queued,
                  ]),
            ))
          .write(
        PendingMediaUploadsCompanion(
          state: const Value<String>(MediaUploadState.queued),
          lastError: Value<String?>(messageSafe),
        ),
      );
      await _bumpBackoff(id, now: now, authLapse: authLapse);
    });
  }

  Future<void> _bumpBackoff(
    String id, {
    required DateTime now,
    required bool authLapse,
  }) async {
    final Map<String, MediaUploadBackoff> all = await _readBackoff();
    final int streak = (all[id]?.streak ?? 0) + 1;
    final int factor = math.pow(2, math.min(streak - 1, 16)).toInt();
    Duration wait = transientBackoffBase * factor;
    if (wait > transientBackoffMax) wait = transientBackoffMax;
    all[id] = MediaUploadBackoff(
      until: now.toUtc().add(wait),
      streak: streak,
      authLapse: authLapse,
    );
    await _writeBackoff(all, now);
  }

  /// The backoff recorded for [id], or null. Clamped like
  /// [mediaIdsInBackoff].
  Future<MediaUploadBackoff?> uploadBackoff(String id, {DateTime? now}) async =>
      (await _sweptBackoff(now ?? DateTime.now()))[id];

  /// Ids of photos whose backoff has not elapsed at [now].
  ///
  /// Also the sweep: an entry is clamped to `now + transientBackoffMax`, so
  /// a phone whose clock ran far ahead and was then corrected cannot park a
  /// photo for months, and entries for photos that no longer wait (uploaded,
  /// verified, abandoned, pruned) are dropped.
  Future<Set<String>> mediaIdsInBackoff(DateTime now) async {
    final DateTime at = now.toUtc();
    return <String>{
      for (final MapEntry<String, MediaUploadBackoff> e
          in (await _sweptBackoff(now)).entries)
        if (e.value.until.isAfter(at)) e.key,
    };
  }

  Future<Map<String, MediaUploadBackoff>> _sweptBackoff(DateTime now) {
    return transaction(() async {
      final Map<String, MediaUploadBackoff> all = await _readBackoff();
      if (all.isEmpty) return all;
      final DateTime ceiling = now.toUtc().add(transientBackoffMax);
      final Set<String> live = <String>{};
      final List<String> ids = all.keys.toList(growable: false);
      for (int i = 0; i < ids.length; i += _inClauseChunk) {
        final List<String> part =
            ids.sublist(i, math.min(i + _inClauseChunk, ids.length));
        final rows = await (select(pendingMediaUploads)
              ..where(
                (t) =>
                    t.id.isIn(part) &
                    t.state.isIn(<String>[
                      MediaUploadState.queued,
                      MediaUploadState.uploading,
                      MediaUploadState.failed,
                    ]),
              ))
            .get();
        live.addAll(rows.map((PendingMediaUpload r) => r.id));
      }
      bool changed = false;
      final Map<String, MediaUploadBackoff> out =
          <String, MediaUploadBackoff>{};
      for (final MapEntry<String, MediaUploadBackoff> e in all.entries) {
        if (!live.contains(e.key)) {
          changed = true;
          continue;
        }
        if (e.value.until.isAfter(ceiling)) {
          changed = true;
          out[e.key] = MediaUploadBackoff(
            until: ceiling,
            streak: e.value.streak,
            authLapse: e.value.authLapse,
          );
        } else {
          out[e.key] = e.value;
        }
      }
      if (changed) await _writeBackoff(out, now);
      return out;
    });
  }

  /// Forgets the backoff of [id] (it uploaded, or was given up for good).
  Future<void> clearUploadBackoff(String id) {
    return transaction(() async {
      final Map<String, MediaUploadBackoff> all = await _readBackoff();
      if (all.remove(id) == null) return;
      await _writeBackoff(all, DateTime.now().toUtc());
    });
  }

  /// Puts `failed` photos of not-yet-synced records back in the queue so a
  /// reason that has since cleared (sign-in, connection back, a person
  /// pressing Retry) gets another chance.
  ///
  /// Bounded, never a loop: each requeue gives [budget] more tries (one by
  /// default) and, unless [force], skips a photo still inside its backoff,
  /// which grows with every refusal. [force] is for a person's own Retry:
  /// it ignores and clears the backoff. Scope with [workspaceId] /
  /// [createdBy] / [commandId]. Abandoned photos are final and untouched.
  Future<int> requeueFailedMedia({
    String? workspaceId,
    String? createdBy,
    String? commandId,
    int budget = 1,
    bool force = false,
    DateTime? now,
  }) =>
      _requeueFailed(
        workspaceId: workspaceId,
        createdBy: createdBy,
        commandId: commandId,
        budget: budget,
        force: force,
        now: now,
      );

  Future<int> _requeueFailed({
    String? workspaceId,
    String? createdBy,
    String? commandId,
    int budget = 1,
    bool force = false,
    DateTime? now,
  }) {
    return transaction(() async {
      final DateTime at = (now ?? DateTime.now()).toUtc();
      final commands = attachedDatabase.pendingCommands;
      final unsynced = selectOnly(commands)
        ..addColumns([commands.id])
        ..where(commands.status.equals(CommandStatus.synced).not());
      if (workspaceId != null) {
        unsynced.where(commands.workspaceId.equals(workspaceId));
      }
      if (createdBy != null) {
        unsynced.where(commands.createdBy.equals(createdBy));
      }
      final rows = await (select(pendingMediaUploads)
            ..where(
              (t) =>
                  t.state.equals(MediaUploadState.failed) &
                  t.commandId.isInQuery(unsynced) &
                  (commandId == null
                      ? const Constant<bool>(true)
                      : t.commandId.equals(commandId)),
            ))
          .get();
      if (rows.isEmpty) return 0;
      final Map<String, MediaUploadBackoff> backoff = await _readBackoff();
      final int attempts = math.max(0, maxUploadAttempts - math.max(1, budget));
      int count = 0;
      for (final PendingMediaUpload row in rows) {
        final MediaUploadBackoff? b = backoff[row.id];
        if (!force && b != null && b.until.isAfter(at)) continue;
        if (force) backoff.remove(row.id);
        await (update(pendingMediaUploads)..where((t) => t.id.equals(row.id)))
            .write(
          PendingMediaUploadsCompanion(
            state: const Value<String>(MediaUploadState.queued),
            attempts: Value<int>(attempts),
          ),
        );
        count++;
      }
      if (force) await _writeBackoff(backoff, at);
      return count;
    });
  }

  /// Older builds spent a photo's attempts on transient failures (no
  /// signal, 5xx, an expired session), so its `failed` rows may be perfectly
  /// uploadable. Those cannot be told apart from a real refusal afterwards,
  /// so they are all requeued once with a full budget; from this build on,
  /// only a definitive refusal can mark a photo `failed`.
  Future<int> requeueLegacyTransientFailuresOnce({
    required DateTime now,
  }) async {
    final table = attachedDatabase.syncMetadata;
    final done = await (select(table)
          ..where((t) => t.key.equals(_legacyRequeueKey))
          ..limit(1))
        .getSingleOrNull();
    if (done != null) return 0;
    // Every account's rows on this phone, not only the active one's.
    final int count = await _requeueFailed(
      budget: maxUploadAttempts,
      force: true,
      now: now,
    );
    await into(table).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(
        key: _legacyRequeueKey,
        valueJson: jsonEncode(<String, Object?>{'requeued': count}),
        updatedAt: now.toUtc(),
      ),
    );
    return count;
  }

  /// Photos that could not upload (`failed`) for the records in
  /// [workspaceId], live, grouped by command. Drives the "photo could not
  /// upload" line on the sync queue screen.
  Stream<Map<String, List<PendingMediaUpload>>> watchFailedMediaByCommand({
    required String workspaceId,
  }) {
    final commands = attachedDatabase.pendingCommands;
    final owners = selectOnly(commands)
      ..addColumns([commands.id])
      ..where(
        commands.workspaceId.equals(workspaceId) &
            commands.status.equals(CommandStatus.synced).not(),
      );
    return (select(pendingMediaUploads)
          ..where(
            (t) =>
                t.state.equals(MediaUploadState.failed) &
                t.commandId.isInQuery(owners),
          )
          ..orderBy([(t) => OrderingTerm.asc(t.orderIndex)]))
        .watch()
        .map((List<PendingMediaUpload> rows) {
      final Map<String, List<PendingMediaUpload>> out =
          <String, List<PendingMediaUpload>>{};
      for (final PendingMediaUpload r in rows) {
        (out[r.commandId] ??= <PendingMediaUpload>[]).add(r);
      }
      return out;
    });
  }

  /// A person chose to send a record WITHOUT a photo that cannot upload.
  /// Removes the photo's queue row and every reference to its local path
  /// from the record's payload, so the record can sync. Only a `failed`
  /// photo of an unsynced record can be removed; returns whether it was.
  ///
  /// This is never automatic: safety evidence is only dropped by a person's
  /// explicit, confirmed choice. The local file is left for the orphan
  /// sweep, which only deletes what nothing references.
  Future<bool> removeFailedPhoto(String mediaId) {
    return transaction(() async {
      final PendingMediaUpload? media = await (select(pendingMediaUploads)
            ..where((t) => t.id.equals(mediaId))
            ..limit(1))
          .getSingleOrNull();
      if (media == null || media.state != MediaUploadState.failed) {
        return false;
      }
      final commands = attachedDatabase.pendingCommands;
      final PendingCommand? command = await (select(commands)
            ..where((t) => t.id.equals(media.commandId))
            ..limit(1))
          .getSingleOrNull();
      if (command == null || command.status == CommandStatus.synced) {
        return false;
      }
      final bool shared = (await (select(pendingMediaUploads)
                ..where(
                  (t) =>
                      t.commandId.equals(command.id) &
                      t.localPath.equals(media.localPath) &
                      t.id.equals(mediaId).not(),
                ))
              .get())
          .isNotEmpty;
      Object? payload;
      try {
        payload = jsonDecode(command.payloadJson);
      } on FormatException {
        return false;
      }
      final Object? stripped =
          shared ? payload : stripPayloadPath(payload, media.localPath);
      await (delete(pendingMediaUploads)..where((t) => t.id.equals(mediaId)))
          .go();
      await (update(commands)..where((t) => t.id.equals(command.id))).write(
        PendingCommandsCompanion(
          payloadJson: Value<String>(jsonEncode(stripped)),
        ),
      );
      final Map<String, MediaUploadBackoff> backoff = await _readBackoff();
      if (backoff.remove(mediaId) != null) {
        await _writeBackoff(backoff, DateTime.now().toUtc());
      }
      return true;
    });
  }

  static const String _backoffKey = 'media.uploadBackoff';
  static const String _legacyRequeueKey = 'media.legacyTransientRequeuedV1';

  Future<Map<String, MediaUploadBackoff>> _readBackoff() async {
    final table = attachedDatabase.syncMetadata;
    final row = await (select(table)
          ..where((t) => t.key.equals(_backoffKey))
          ..limit(1))
        .getSingleOrNull();
    final Map<String, MediaUploadBackoff> out = <String, MediaUploadBackoff>{};
    if (row == null) return out;
    try {
      final Object? decoded = jsonDecode(row.valueJson);
      if (decoded is! Map<String, Object?>) return out;
      for (final MapEntry<String, Object?> e in decoded.entries) {
        final MediaUploadBackoff? b = MediaUploadBackoff.tryParse(e.value);
        if (b != null) out[e.key] = b;
      }
    } on FormatException {
      return out;
    }
    return out;
  }

  Future<void> _writeBackoff(
    Map<String, MediaUploadBackoff> all,
    DateTime now,
  ) async {
    final table = attachedDatabase.syncMetadata;
    if (all.isEmpty) {
      await (delete(table)..where((t) => t.key.equals(_backoffKey))).go();
      return;
    }
    await into(table).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(
        key: _backoffKey,
        valueJson: jsonEncode(<String, Object?>{
          for (final MapEntry<String, MediaUploadBackoff> e in all.entries)
            e.key: e.value.toJson(),
        }),
        updatedAt: now.toUtc(),
      ),
    );
  }

  /// Puts a claimed photo back without counting an attempt. The drain uses
  /// this so one sync pass tries each photo at most once.
  Future<int> releaseUploadClaim(String id) {
    return (update(pendingMediaUploads)
          ..where(
            (t) => t.id.equals(id) & t.state.equals(MediaUploadState.uploading),
          ))
        .write(
      const PendingMediaUploadsCompanion(
        state: Value<String>(MediaUploadState.queued),
      ),
    );
  }

  /// Whether every photo attached to a command has been confirmed.
  ///
  /// The sync engine must not write the business row without its evidence: the
  /// React Native loop throws "photos pending upload, will retry" rather than
  /// inserting a record whose photographs are unreachable.
  Future<bool> commandMediaReady(String commandId) async {
    final outstanding = await (select(pendingMediaUploads)
          ..where(
            (t) =>
                t.commandId.equals(commandId) &
                t.state.equals(MediaUploadState.uploaded).not() &
                t.state.equals(MediaUploadState.verified).not(),
          )
          ..limit(1))
        .get();
    return outstanding.isEmpty;
  }

  // -- Draft media ----------------------------------------------------------

  /// Records a photo attached to a draft.
  ///
  /// [localPath] must already point inside the DRAFT media folder. Writing a
  /// draft photo into the queue folder is the recorded defect this whole file
  /// is shaped around.
  Future<DraftPhoto> addDraftPhoto({
    required String ownerKind,
    required String ownerKey,
    required String localPath,
    required String fileName,
    required DateTime capturedAt,
    String? id,
    String? fieldKey,
    int? sizeBytes,
    String? mimeType,
    String? checksum,
  }) async {
    final String photoId = id ?? _uuid.v4();
    await into(draftPhotos).insert(
      DraftPhotosCompanion.insert(
        id: photoId,
        ownerKind: ownerKind,
        ownerKey: ownerKey,
        localPath: localPath,
        fileName: fileName,
        capturedAt: capturedAt,
        fieldKey: Value<String?>(fieldKey),
        sizeBytes: Value<int?>(sizeBytes),
        mimeType: Value<String?>(mimeType),
        checksum: Value<String?>(checksum),
      ),
    );
    return (select(draftPhotos)
          ..where((t) => t.id.equals(photoId))
          ..limit(1))
        .getSingle();
  }

  Future<List<DraftPhoto>> draftPhotosFor({
    required String ownerKind,
    required String ownerKey,
  }) {
    return (select(draftPhotos)
          ..where(
            (t) => t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
          )
          ..orderBy([
            (t) => OrderingTerm.asc(t.fieldKey),
            (t) => OrderingTerm.asc(t.capturedAt),
          ]))
        .get();
  }

  /// Repoints a photo row at the path the file is actually at now.
  ///
  /// iOS rewrites the document container path between launches, so an absolute
  /// path stored yesterday can be stale while the file is perfectly intact. The
  /// heal looks for the same basename in the current folder, which is why
  /// `fileName` is its own indexed column.
  Future<int> healDraftPhotoPath({
    required String fileName,
    required String localPath,
  }) {
    return (update(draftPhotos)..where((t) => t.fileName.equals(fileName)))
        .write(DraftPhotosCompanion(localPath: Value<String>(localPath)));
  }

  /// Drops a photo row whose file no longer exists anywhere.
  ///
  /// A restore never lies about a photo: if neither the stored path nor the
  /// healed path resolves, the row goes and the screen is told how many were
  /// dropped. Carrying a dead path forward means submitting evidence that is
  /// unreachable for everyone while reporting success.
  Future<int> dropMissingDraftPhoto(String id) {
    return (delete(draftPhotos)..where((t) => t.id.equals(id))).go();
  }

  // -- Signatures -----------------------------------------------------------

  /// Stores one mark for one field.
  ///
  /// One signature PER FIELD, enforced by the unique index on
  /// (ownerKind, ownerKey, fieldKey). A shared slot is what let three trades
  /// signing a workshop sheet overwrite one another, so only the last reached
  /// the database while every signature tile read "signed".
  ///
  /// Rejects a payload that is neither an SVG document nor a data URL. Anything
  /// else is not a mark this app draws, and storing it would put an arbitrary
  /// string in front of a reader as though it were a signature - the recorded
  /// placeholder defect.
  Future<CapturedSignature> saveSignature({
    required String ownerKind,
    required String ownerKey,
    required String fieldKey,
    required String payload,
    required String source,
    required DateTime signedAt,
    String? id,
    String? strokesJson,
    String? signerUserId,
    String? signerName,
    String? signerRole,
  }) async {
    final String? format = signaturePayloadFormat(payload);
    if (format == null) {
      throw ArgumentError.value(
        payload.length > 32 ? '${payload.substring(0, 32)}...' : payload,
        'payload',
        'not a signature: expected an <svg document or a data: URL',
      );
    }
    if (payload.length > signatureMaxLength) {
      throw ArgumentError.value(
        payload.length,
        'payload',
        'signature is longer than the server column accepts '
            '($signatureMaxLength characters)',
      );
    }

    final String signatureId = id ?? _uuid.v4();
    return transaction(() async {
      await (delete(capturedSignatures)
            ..where(
              (t) =>
                  t.ownerKind.equals(ownerKind) &
                  t.ownerKey.equals(ownerKey) &
                  t.fieldKey.equals(fieldKey),
            ))
          .go();

      await into(capturedSignatures).insert(
        CapturedSignaturesCompanion.insert(
          id: signatureId,
          ownerKind: ownerKind,
          ownerKey: ownerKey,
          fieldKey: fieldKey,
          format: format,
          payload: payload,
          source: source,
          signedAt: signedAt,
          strokesJson: Value<String?>(strokesJson),
          signerUserId: Value<String?>(signerUserId),
          signerName: Value<String?>(signerName),
          signerRole: Value<String?>(signerRole),
        ),
      );

      return (select(capturedSignatures)
            ..where((t) => t.id.equals(signatureId))
            ..limit(1))
          .getSingle();
    });
  }

  Future<List<CapturedSignature>> signaturesFor({
    required String ownerKind,
    required String ownerKey,
  }) {
    return (select(capturedSignatures)
          ..where(
            (t) => t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
          )
          ..orderBy([(t) => OrderingTerm.asc(t.fieldKey)]))
        .get();
  }

  /// Removes the mark for one field without disturbing any other signature
  /// captured on the same draft.
  Future<int> deleteSignature({
    required String ownerKind,
    required String ownerKey,
    required String fieldKey,
  }) {
    return (delete(capturedSignatures)
          ..where(
            (t) =>
                t.ownerKind.equals(ownerKind) &
                t.ownerKey.equals(ownerKey) &
                t.fieldKey.equals(fieldKey),
          ))
        .go();
  }

  /// Whether a template's `require_signature` flag is satisfied.
  ///
  /// Satisfied by the template-level pad OR any signed field, which is a query
  /// over the owner rather than a check of one column. RECORDED: the flag lives
  /// on the TEMPLATE while the only way to capture a mark was a signature
  /// FIELD, so a template with the flag and no such field could be filled
  /// completely and NEVER submitted, and the work was lost on back-out.
  Future<bool> hasAnySignature({
    required String ownerKind,
    required String ownerKey,
  }) async {
    final rows = await (select(capturedSignatures)
          ..where(
            (t) => t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
          )
          ..limit(1))
        .get();
    return rows.isNotEmpty;
  }

  // -- The sweep ------------------------------------------------------------

  /// The file names among [candidateFileNames] that something still needs.
  ///
  /// A file is referenced when EITHER:
  ///
  /// - a `pending_media_uploads` row holds it in any state other than
  ///   `verified` - unverified queue evidence, which the owning command has not
  ///   yet delivered; or
  /// - a `draft_photos` row holds it at all - a part-filled sheet's evidence,
  ///   which no queue row will ever mention because a draft is not a queue
  ///   entry.
  ///
  /// Both halves are required. Drop the queue half and the sweep deletes a
  /// photo an inspection is still waiting to upload. Drop the draft half and it
  /// deletes the operator's part-filled sheet's photographs on the next sync,
  /// which is the exact recorded incident.
  Future<Set<String>> referencedFileNames(
    Iterable<String> candidateFileNames,
  ) async {
    final List<String> candidates = candidateFileNames.toList(growable: false);
    if (candidates.isEmpty) {
      return <String>{};
    }

    final referenced = <String>{};
    for (int start = 0; start < candidates.length; start += _inClauseChunk) {
      final int end = start + _inClauseChunk < candidates.length
          ? start + _inClauseChunk
          : candidates.length;
      final List<String> chunk = candidates.sublist(start, end);

      final queued = await (select(pendingMediaUploads)
            ..where(
              (t) =>
                  t.fileName.isIn(chunk) &
                  t.state.equals(MediaUploadState.verified).not(),
            ))
          .get();
      referenced.addAll(queued.map((PendingMediaUpload row) => row.fileName));

      final drafted = await (select(
        draftPhotos,
      )..where((t) => t.fileName.isIn(chunk)))
          .get();
      referenced.addAll(drafted.map((DraftPhoto row) => row.fileName));
    }
    return referenced;
  }

  /// The file names among [candidateFileNames] that are safe to delete.
  ///
  /// The caller lists a media folder and passes the basenames it found. The
  /// answer is a set difference against [referencedFileNames], so a file with
  /// no row is an orphan and the question is one query rather than a directory
  /// listing compared against an in-memory set assembled by hand.
  Future<List<String>> orphanFileNames(
    Iterable<String> candidateFileNames,
  ) async {
    final List<String> candidates = candidateFileNames.toList(growable: false);
    if (candidates.isEmpty) {
      return const <String>[];
    }
    final Set<String> referenced = await referencedFileNames(candidates);
    return candidates
        .where((String name) => !referenced.contains(name))
        .toList(growable: false);
  }
}

/// Removes every occurrence of [path] from a decoded payload: list elements
/// equal to it are dropped, and a map value equal to it becomes null. Other
/// values are kept exactly.
Object? stripPayloadPath(Object? value, String path) {
  if (value is List<Object?>) {
    return <Object?>[
      for (final Object? v in value)
        if (v != path) stripPayloadPath(v, path),
    ];
  }
  if (value is Map<String, Object?>) {
    return <String, Object?>{
      for (final MapEntry<String, Object?> e in value.entries)
        e.key: e.value == path ? null : stripPayloadPath(e.value, path),
    };
  }
  return value;
}

/// The wait recorded after a failed upload.
final class MediaUploadBackoff {
  const MediaUploadBackoff({
    required this.until,
    required this.streak,
    this.authLapse = false,
  });

  /// Not retried before this instant.
  final DateTime until;

  /// Consecutive transient failures.
  final int streak;

  /// The last failure was a lapsed session, not the photo or the network.
  final bool authLapse;

  Map<String, Object?> toJson() => <String, Object?>{
        'until': until.toUtc().toIso8601String(),
        'streak': streak,
        'auth': authLapse,
      };

  static MediaUploadBackoff? tryParse(Object? raw) {
    if (raw is! Map<String, Object?>) return null;
    final Object? until = raw['until'];
    final Object? streak = raw['streak'];
    if (until is! String || streak is! int) return null;
    final DateTime? at = DateTime.tryParse(until);
    if (at == null) return null;
    return MediaUploadBackoff(
      until: at.toUtc(),
      streak: streak,
      authLapse: raw['auth'] == true,
    );
  }
}

/// Recognises the two payload shapes a signature may take.
///
/// The checklist path emits self-contained `<svg` markup and the canvas pad
/// emits a `data:image/...` URL, and both must be accepted. Everything else is
/// refused, and that refusal is the guard against storing a placeholder string
/// where a signature belongs.
String? signaturePayloadFormat(String payload) {
  final String trimmed = payload.trimLeft();
  if (trimmed.startsWith('<svg')) {
    return SignatureFormat.svg;
  }
  if (trimmed.startsWith('data:')) {
    return SignatureFormat.dataUrl;
  }
  return null;
}
