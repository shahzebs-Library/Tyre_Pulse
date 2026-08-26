/// The in-progress inspection: reads and writes over `DraftsDao` and
/// `MediaDao`, translated into and out of this feature's own domain types.
///
/// # This is risk R2's fix
///
/// `docs/flutter-migration/09-migration-matrix.md` risk R2: "The inspection
/// capture screen has no draft in production... Backgrounding plus an
/// Android process reclaim loses it silently." Every write in this file
/// lands in a real Drift row before the method returns, so the draft
/// survives a process kill at any point - there is no in-memory-only
/// window the way there was in `app/(app)/inspection/new.tsx`'s React
/// state.
///
/// # Ownership boundary
///
/// This file CONSUMES `DraftsDao` and `MediaDao`
/// (`lib/core/database/dao/*.dart`) exactly as they are - it adds no
/// migration, no table and no column, matching the phase boundary that
/// those tables/DAOs "already exist... you consume them, you do not add
/// migrations or new tables". `OwnerKind.inspectionDraft` and
/// `primarySignatureFieldKey` are read, never redefined, from
/// `database_constants.dart`.
///
/// # The draft is NOT discarded at submit time
///
/// [InspectionSubmissionQueue]'s own library comment explains why: the
/// draft (and its photo/signature rows) remain the durable source of truth
/// a queued-but-unsynced submission is retried from, so [discardDraft] is
/// called by `InspectionSyncEngine` ONLY once a submission is confirmed
/// [InspectionQueueStatus.synced] - never by this repository itself, and
/// never merely because a submit button was pressed.
library;

import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

/// One draft photo, decoded for the presentation layer.
class InspectionDraftPhoto {
  const InspectionDraftPhoto({
    required this.id,
    required this.position,
    required this.localPath,
    required this.capturedAt,
  });

  final String id;
  final String position;
  final String localPath;
  final DateTime capturedAt;
}

/// One captured signature, decoded for the presentation layer.
class InspectionDraftSignature {
  const InspectionDraftSignature({
    required this.payload,
    required this.format,
    required this.source,
    this.strokesJson,
  });

  final String payload;
  final String format;
  final String source;
  final String? strokesJson;
}

/// The narrow surface the wizard needs. Abstract so a controller test can
/// substitute an in-memory fake without a real Drift database - the same
/// seam `TyreLookupRepository` establishes for its own feature.
abstract interface class InspectionDraftRepository {
  /// Creates the draft if it does not exist, or updates its header fields
  /// if it does. [createdAt] is never reset on an update - see
  /// `DraftsDao.saveInspectionDraft`'s own doc comment.
  Future<void> saveHeader({
    required String userId,
    required String workspaceId,
    required String assetNo,
    required int filled,
    required int total,
    String? country,
    String? vehicleType,
    String? site,
    String? inspectorName,
    int? odometerKm,
    double? engineHours,
    String? findings,
  });

  /// The single write path for a tyre-position edit. ALWAYS stamps
  /// `checked: true` - see [TyrePositionReading.checked]'s own doc
  /// comment for why every deliberate interaction, including confirming a
  /// default Good reading, must route through here.
  Future<void> saveTyreReading(String draftKey, TyrePositionReading reading);

  /// All positions currently recorded for [draftKey], as a map ready to
  /// hand to [tyreCompleteness] / [VehicleTyreDiagram].
  Future<Map<String, TyrePositionReading>> tyreReadings(String draftKey);

  /// [tyreReadings] with each position's photo folded in from
  /// [photosFor], since a photo lives in a SEPARATE table
  /// ([InspectionDraftPhoto]/`DraftPhotos`) from the reading itself
  /// ([InspectionDraftPositions] carries no photo column at all - photos
  /// have their own lifecycle and their own owning table, per
  /// `draft_tables.dart`'s own design). When a position has more than one
  /// captured photo (a retake), the MOST RECENTLY captured one is the
  /// position's evidentiary photo - the same "last reading for a slot
  /// wins" precedent `tyre_completeness.dart`'s `bySlot.putIfAbsent`
  /// establishes for readings generally, applied here to photos. This is
  /// the shape every consumer of a draft's tyre data should read through;
  /// [tyreReadings] alone is for a caller that genuinely only needs the
  /// numeric/condition fields.
  Future<Map<String, TyrePositionReading>> tyreReadingsWithPhotos(
    String draftKey,
  );

  /// Attaches a captured, already-resized photo file (already copied into
  /// the durable draft media folder by the caller) to [position] on
  /// [draftKey].
  Future<void> addPhoto({
    required String draftKey,
    required String position,
    required String localPath,
    required DateTime capturedAt,
    int? sizeBytes,
    String? mimeType,
  });

  /// Every photo currently attached to [draftKey], across all positions.
  Future<List<InspectionDraftPhoto>> photosFor(String draftKey);

  /// The inspector's signature for [draftKey], if one has been drawn.
  Future<InspectionDraftSignature?> signature(String draftKey);

  /// Saves the inspector's signature. There is exactly one signing slot
  /// per inspection draft ([primarySignatureFieldKey]) - unlike a
  /// checklist, which carries one per trade.
  Future<void> saveSignature({
    required String draftKey,
    required String payload,
    required String source,
    String? strokesJson,
    String? signerUserId,
    String? signerName,
  });

  /// The unfinished-work list for [userId], newest first.
  Future<List<InspectionDraftSummary>> draftsForUser(String userId);

  /// Whether [draftKey] holds real work - progress, a photo or a
  /// signature - as opposed to a sheet that was merely opened. See
  /// `DraftsDao.draftHasContent`'s own doc comment on why this is
  /// deliberately stricter than "any field is non-blank".
  Future<bool> hasContent(String draftKey);

  /// Discards the draft header, its positions, its photos and its
  /// signature. Returns the local photo file paths whose rows were
  /// removed, so the CALLER can delete the underlying files - see the
  /// library comment on when this may be called.
  Future<List<String>> discardDraft(String draftKey);
}

final class DriftInspectionDraftRepository
    implements InspectionDraftRepository {
  DriftInspectionDraftRepository(this._draftsDao, this._mediaDao);

  final DraftsDao _draftsDao;
  final MediaDao _mediaDao;

  static const String _ownerKind = OwnerKind.inspectionDraft;

  String draftKeyFor({required String userId, required String assetNo}) =>
      DraftsDao.inspectionDraftKey(userId: userId, assetNo: assetNo);

  @override
  Future<void> saveHeader({
    required String userId,
    required String workspaceId,
    required String assetNo,
    required int filled,
    required int total,
    String? country,
    String? vehicleType,
    String? site,
    String? inspectorName,
    int? odometerKm,
    double? engineHours,
    String? findings,
  }) {
    return _draftsDao.saveInspectionDraft(
      userId: userId,
      workspaceId: workspaceId,
      assetNo: assetNo,
      filled: filled,
      total: total,
      now: DateTime.now().toUtc(),
      country: country,
      vehicleType: vehicleType,
      site: site,
      inspectorName: inspectorName,
      odometerKm: odometerKm,
      engineHours: engineHours,
      findings: findings,
    );
  }

  @override
  Future<void> saveTyreReading(String draftKey, TyrePositionReading reading) {
    return _draftsDao.saveInspectionPosition(
      draftKey: draftKey,
      position: reading.position,
      now: DateTime.now().toUtc(),
      condition: reading.condition,
      pressurePsi: reading.pressurePsi,
      treadDepthMm: reading.treadDepthMm,
      serialNo: reading.serialNumber,
      // ALWAYS true - see the interface doc comment. A caller that wants
      // to seed a position without marking it attended-to should not call
      // this method at all; the seed is expressed purely in the
      // presentation layer's initial map, never written here.
      checked: true,
    );
  }

  @override
  Future<Map<String, TyrePositionReading>> tyreReadings(String draftKey) async {
    final rows = await _draftsDao.inspectionPositions(draftKey);
    return <String, TyrePositionReading>{
      for (final row in rows)
        row.position: TyrePositionReading(
          position: row.position,
          serialNumber: row.serialNo,
          pressurePsi: row.pressurePsi,
          treadDepthMm: row.treadDepthMm,
          condition: row.condition ?? TyreReadingCondition.good,
          checked: row.checked,
        ),
    };
  }

  @override
  Future<Map<String, TyrePositionReading>> tyreReadingsWithPhotos(
    String draftKey,
  ) async {
    final Map<String, TyrePositionReading> readings = await tyreReadings(
      draftKey,
    );
    final List<InspectionDraftPhoto> photos = await photosFor(draftKey);

    final Map<String, InspectionDraftPhoto> latestByPosition =
        <String, InspectionDraftPhoto>{};
    for (final InspectionDraftPhoto photo in photos) {
      final InspectionDraftPhoto? current = latestByPosition[photo.position];
      if (current == null || photo.capturedAt.isAfter(current.capturedAt)) {
        latestByPosition[photo.position] = photo;
      }
    }

    final Map<String, TyrePositionReading> merged =
        <String, TyrePositionReading>{...readings};
    latestByPosition.forEach((String position, InspectionDraftPhoto photo) {
      final TyrePositionReading base =
          merged[position] ?? TyrePositionReading.seed(position);
      merged[position] = base.copyWith(photoLocalPath: photo.localPath);
    });
    return merged;
  }

  @override
  Future<void> addPhoto({
    required String draftKey,
    required String position,
    required String localPath,
    required DateTime capturedAt,
    int? sizeBytes,
    String? mimeType,
  }) async {
    await _mediaDao.addDraftPhoto(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
      localPath: localPath,
      fileName: _basename(localPath),
      capturedAt: capturedAt,
      fieldKey: position,
      sizeBytes: sizeBytes,
      mimeType: mimeType,
    );
  }

  @override
  Future<List<InspectionDraftPhoto>> photosFor(String draftKey) async {
    final rows = await _mediaDao.draftPhotosFor(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
    );
    return <InspectionDraftPhoto>[
      for (final row in rows)
        InspectionDraftPhoto(
          id: row.id,
          position: row.fieldKey ?? '',
          localPath: row.localPath,
          capturedAt: row.capturedAt,
        ),
    ];
  }

  @override
  Future<InspectionDraftSignature?> signature(String draftKey) async {
    final rows = await _mediaDao.signaturesFor(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
    );
    for (final row in rows) {
      if (row.fieldKey == primarySignatureFieldKey) {
        return InspectionDraftSignature(
          payload: row.payload,
          format: row.format,
          source: row.source,
          strokesJson: row.strokesJson,
        );
      }
    }
    return null;
  }

  @override
  Future<void> saveSignature({
    required String draftKey,
    required String payload,
    required String source,
    String? strokesJson,
    String? signerUserId,
    String? signerName,
  }) async {
    await _mediaDao.saveSignature(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
      fieldKey: primarySignatureFieldKey,
      payload: payload,
      source: source,
      signedAt: DateTime.now().toUtc(),
      strokesJson: strokesJson,
      signerUserId: signerUserId,
      signerName: signerName,
    );
  }

  @override
  Future<List<InspectionDraftSummary>> draftsForUser(String userId) async {
    final rows = await _draftsDao.inspectionDraftsForUser(userId);
    return <InspectionDraftSummary>[
      for (final row in rows)
        InspectionDraftSummary(
          draftKey: row.draftKey,
          assetNo: row.assetNo,
          site: row.site,
          vehicleType: row.vehicleType,
          filled: row.filled,
          total: row.total,
          updatedAt: row.updatedAt,
        ),
    ];
  }

  @override
  Future<bool> hasContent(String draftKey) async {
    final header = await _draftsDao.inspectionDraft(draftKey);
    return _draftsDao.draftHasContent(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
      filled: header?.filled ?? 0,
    );
  }

  @override
  Future<List<String>> discardDraft(String draftKey) {
    return _draftsDao.discardInspectionDraft(draftKey);
  }

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }
}
