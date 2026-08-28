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
  Future<List<PendingMediaUpload>> claimNextUploads({
    int limit = uploadConcurrency,
  }) async {
    return transaction(() async {
      final due = await (select(pendingMediaUploads)
            ..where(
              (t) =>
                  t.state.equals(MediaUploadState.queued) &
                  t.attempts.isSmallerThanValue(maxUploadAttempts),
            )
            ..orderBy([
              (t) => OrderingTerm.asc(t.capturedAt),
              (t) => OrderingTerm.asc(t.id),
            ])
            ..limit(limit))
          .get();

      final claimed = <PendingMediaUpload>[];
      for (final PendingMediaUpload row in due) {
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
  Future<PendingMediaUpload> markUploadAttemptFailed(
    String id, {
    required String messageSafe,
  }) async {
    return transaction(() async {
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
