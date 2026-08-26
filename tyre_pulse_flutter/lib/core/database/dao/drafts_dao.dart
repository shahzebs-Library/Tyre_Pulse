/// Reads and writes for part-filled work that exists only on this device.
///
/// Two properties are preserved from the React Native draft store and one is
/// removed.
///
/// PRESERVED: the draft key carries the user id, so two people filling the same
/// sheet on a shared handset produce two rows and overwriting is not possible,
/// it is not merely avoided. And every read filters on the signed-in user - a
/// blank user id returns nothing at all rather than everything, because a query
/// that forgets the filter shows a technician their colleague's work.
///
/// REMOVED: the promise chain that serialised writes. The React Native store
/// needed one because the autosave timer and the backgrounding flush are each a
/// read-modify-write over one shared blob, and run concurrently the slower one
/// writes a list assembled before the faster one's change existed and silently
/// reverts it. Here an autosave is an upsert of one row plus a diff of its
/// children inside one transaction, so two concurrent autosaves serialise at
/// the database and neither can revert the other's columns. The property is
/// ported; the mechanism is not.
library;

import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/database/tables/draft_tables.dart';
import 'package:uuid/uuid.dart';

part 'drafts_dao.g.dart';

/// Drafts, their tyre positions, their photos and their signatures.
@DriftAccessor(
  tables: <Type>[
    InspectionDrafts,
    InspectionDraftPositions,
    ChecklistDrafts,
    DraftPhotos,
    CapturedSignatures,
  ],
)
class DraftsDao extends DatabaseAccessor<AppDatabase> with _$DraftsDaoMixin {
  DraftsDao(super.attachedDatabase);

  static const Uuid _uuid = Uuid();

  /// `userId|ASSETNO`. Built here so a screen cannot invent a variant.
  ///
  /// Normalising the asset is what treats the same machine typed differently as
  /// one sheet. Without it `tm514`, `TM514` and ` TM514 ` are three drafts of
  /// the same job and the operator finishes one of them.
  static String inspectionDraftKey({
    required String userId,
    required String assetNo,
  }) => '$userId|${normaliseLookupKey(assetNo)}';

  /// `userId|templateId|ASSETNO`. An empty asset is a legitimate component: a
  /// sheet started before a machine is picked gets its own slot, and the row is
  /// rekeyed once one is chosen.
  static String checklistDraftKey({
    required String userId,
    required String templateId,
    required String assetNo,
  }) => '$userId|$templateId|${normaliseLookupKey(assetNo)}';

  // -- Inspection drafts ----------------------------------------------------

  /// Creates or updates an inspection draft header.
  ///
  /// [createdAt] is preserved across later saves: it is read from the existing
  /// row when there is one, so an autosave cannot reset the age the unfinished
  /// list shows.
  Future<InspectionDraft> saveInspectionDraft({
    required String userId,
    required String workspaceId,
    required String assetNo,
    required int filled,
    required int total,
    required DateTime now,
    String? country,
    String? vehicleType,
    String? site,
    String? inspectorName,
    int? odometerKm,
    double? engineHours,
    String? findings,
  }) async {
    final String key = inspectionDraftKey(userId: userId, assetNo: assetNo);

    return transaction(() async {
      final InspectionDraft? existing = await inspectionDraft(key);

      await into(inspectionDrafts).insertOnConflictUpdate(
        InspectionDraftsCompanion.insert(
          draftKey: key,
          userId: userId,
          workspaceId: workspaceId,
          assetNo: normaliseLookupKey(assetNo),
          filled: filled,
          total: total,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          country: Value<String?>(country),
          vehicleType: Value<String?>(vehicleType),
          site: Value<String?>(site),
          inspectorName: Value<String?>(inspectorName),
          odometerKm: Value<int?>(odometerKm),
          engineHours: Value<double?>(engineHours),
          findings: Value<String?>(findings),
        ),
      );

      return (select(inspectionDrafts)
            ..where((t) => t.draftKey.equals(key))
            ..limit(1))
          .getSingle();
    });
  }

  Future<InspectionDraft?> inspectionDraft(String draftKey) {
    return (select(inspectionDrafts)
          ..where((t) => t.draftKey.equals(draftKey))
          ..limit(1))
        .getSingleOrNull();
  }

  /// "My unfinished work, newest first."
  ///
  /// Returns nothing for a blank user id rather than everything. The React
  /// Native test pins this as "offers nothing at all when there is no signed-in
  /// user", and the reason is a shared handset.
  Future<List<InspectionDraft>> inspectionDraftsForUser(String userId) {
    if (userId.isEmpty) {
      return Future<List<InspectionDraft>>.value(const <InspectionDraft>[]);
    }
    return (select(inspectionDrafts)
          ..where((t) => t.userId.equals(userId))
          ..orderBy([
            (t) => OrderingTerm.desc(t.updatedAt),
            (t) => OrderingTerm.desc(t.draftKey),
          ]))
        .get();
  }

  /// Records one wheel.
  ///
  /// This is the SINGLE write path for a tyre edit, which is what makes
  /// [InspectionDraftPositions.checked] meaningful: every deliberate
  /// interaction stamps it true, so a seeded Good and a chosen Good stop being
  /// byte-identical.
  Future<void> saveInspectionPosition({
    required String draftKey,
    required String position,
    required DateTime now,
    String? condition,
    double? pressurePsi,
    double? treadDepthMm,
    String? serialNo,
    bool checked = true,
  }) async {
    await transaction(() async {
      final existing =
          await (select(inspectionDraftPositions)
                ..where(
                  (t) =>
                      t.draftKey.equals(draftKey) & t.position.equals(position),
                )
                ..limit(1))
              .getSingleOrNull();

      if (existing == null) {
        await into(inspectionDraftPositions).insert(
          InspectionDraftPositionsCompanion.insert(
            id: _uuid.v4(),
            draftKey: draftKey,
            position: position,
            updatedAt: now,
            condition: Value<String?>(condition),
            pressurePsi: Value<double?>(pressurePsi),
            treadDepthMm: Value<double?>(treadDepthMm),
            serialNo: Value<String?>(serialNo),
            checked: Value<bool>(checked),
          ),
        );
        return;
      }

      await (update(
        inspectionDraftPositions,
      )..where((t) => t.id.equals(existing.id))).write(
        InspectionDraftPositionsCompanion(
          condition: Value<String?>(condition),
          pressurePsi: Value<double?>(pressurePsi),
          treadDepthMm: Value<double?>(treadDepthMm),
          serialNo: Value<String?>(serialNo),
          checked: Value<bool>(checked),
          updatedAt: Value<DateTime>(now),
        ),
      );
    });
  }

  Future<List<InspectionDraftPosition>> inspectionPositions(String draftKey) {
    return (select(inspectionDraftPositions)
          ..where((t) => t.draftKey.equals(draftKey))
          ..orderBy([(t) => OrderingTerm.asc(t.position)]))
        .get();
  }

  /// The positions the operator has actually attended to.
  ///
  /// Only an explicit `checked` counts. The completeness gate asks "which of
  /// this vehicle's positions has no row, and which has a row with no
  /// evidence"; this answers the second half without being fooled by a seeded
  /// default.
  Future<Set<String>> checkedPositions(String draftKey) async {
    final rows =
        await (select(inspectionDraftPositions)..where(
              (t) => t.draftKey.equals(draftKey) & t.checked.equals(true),
            ))
            .get();
    return rows.map((InspectionDraftPosition r) => r.position).toSet();
  }

  // -- Checklist drafts -----------------------------------------------------

  Future<ChecklistDraft> saveChecklistDraft({
    required String userId,
    required String workspaceId,
    required String templateId,
    required String templateName,
    required int templateVersion,
    required String assetNo,
    required String answersJson,
    required String notesJson,
    required int filled,
    required int total,
    required DateTime now,
    String? assignmentId,
    String? site,
    String? title,
    String? readLang,
    String? printedName,
  }) async {
    final String key = checklistDraftKey(
      userId: userId,
      templateId: templateId,
      assetNo: assetNo,
    );

    return transaction(() async {
      final ChecklistDraft? existing = await checklistDraft(key);

      await into(checklistDrafts).insertOnConflictUpdate(
        ChecklistDraftsCompanion.insert(
          draftKey: key,
          userId: userId,
          workspaceId: workspaceId,
          templateId: templateId,
          templateName: templateName,
          templateVersion: templateVersion,
          assetNo: normaliseLookupKey(assetNo),
          answersJson: answersJson,
          notesJson: notesJson,
          filled: filled,
          total: total,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          assignmentId: Value<String?>(assignmentId),
          site: Value<String?>(site),
          title: Value<String?>(title),
          readLang: Value<String?>(readLang),
          printedName: Value<String?>(printedName),
        ),
      );

      return (select(checklistDrafts)
            ..where((t) => t.draftKey.equals(key))
            ..limit(1))
          .getSingle();
    });
  }

  Future<ChecklistDraft?> checklistDraft(String draftKey) {
    return (select(checklistDrafts)
          ..where((t) => t.draftKey.equals(draftKey))
          ..limit(1))
        .getSingleOrNull();
  }

  Future<List<ChecklistDraft>> checklistDraftsForUser(String userId) {
    if (userId.isEmpty) {
      return Future<List<ChecklistDraft>>.value(const <ChecklistDraft>[]);
    }
    return (select(checklistDrafts)
          ..where((t) => t.userId.equals(userId))
          ..orderBy([
            (t) => OrderingTerm.desc(t.updatedAt),
            (t) => OrderingTerm.desc(t.draftKey),
          ]))
        .get();
  }

  /// Sheets that could be resumed for [templateId].
  ///
  /// Narrows to one machine once an asset is known and offers every sheet for
  /// the template while none is picked, which is the resume index used two
  /// ways.
  Future<List<ChecklistDraft>> resumeCandidates({
    required String userId,
    required String templateId,
    String? assetNo,
  }) {
    if (userId.isEmpty) {
      return Future<List<ChecklistDraft>>.value(const <ChecklistDraft>[]);
    }
    final String? normalised = assetNo == null
        ? null
        : normaliseLookupKey(assetNo);

    return (select(checklistDrafts)
          ..where((t) {
            final Expression<bool> base =
                t.userId.equals(userId) & t.templateId.equals(templateId);
            if (normalised == null || normalised.isEmpty) {
              return base;
            }
            return base & t.assetNo.equals(normalised);
          })
          ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
        .get();
  }

  // -- Discard and prune ----------------------------------------------------

  /// Discards a draft and everything attached to it.
  ///
  /// Returns the local paths of the photos whose rows were removed, so the
  /// caller can delete the files afterwards. Rows first, then files: the
  /// reverse order orphans a row on a crash and the sweep never finds it.
  ///
  /// The cascade is performed here rather than declared as a foreign key
  /// because `ownerKind` is polymorphic across two draft tables and SQLite
  /// cannot express that relationship. The tyre positions DO cascade in SQL,
  /// through a real foreign key.
  Future<List<String>> discardInspectionDraft(String draftKey) {
    return _discardDraft(
      ownerKind: OwnerKind.inspectionDraft,
      ownerKey: draftKey,
      deleteHeader: () async {
        await (delete(
          inspectionDrafts,
        )..where((t) => t.draftKey.equals(draftKey))).go();
      },
    );
  }

  Future<List<String>> discardChecklistDraft(String draftKey) {
    return _discardDraft(
      ownerKind: OwnerKind.checklistDraft,
      ownerKey: draftKey,
      deleteHeader: () async {
        await (delete(
          checklistDrafts,
        )..where((t) => t.draftKey.equals(draftKey))).go();
      },
    );
  }

  /// Trims each draft table to its count cap, oldest first.
  ///
  /// By COUNT and never by age. A sheet abandoned for two months is still the
  /// operator's work, and it is listed with its age so a PERSON decides,
  /// rather than the app deleting it quietly.
  ///
  /// Returns the photo paths of the discarded drafts.
  Future<List<String>> pruneDraftsToCap({
    required String userId,
    int inspectionCap = RetentionLimits.inspectionDrafts,
    int checklistCap = RetentionLimits.checklistDrafts,
  }) async {
    if (userId.isEmpty) {
      return const <String>[];
    }

    final removed = <String>[];

    final inspections = await inspectionDraftsForUser(userId);
    for (final InspectionDraft draft in inspections.skip(inspectionCap)) {
      removed.addAll(await discardInspectionDraft(draft.draftKey));
    }

    final checklists = await checklistDraftsForUser(userId);
    for (final ChecklistDraft draft in checklists.skip(checklistCap)) {
      removed.addAll(await discardChecklistDraft(draft.draftKey));
    }

    return removed;
  }

  /// Whether a draft is real work or merely a sheet somebody opened.
  ///
  /// Deliberately strict, for a specific reason: the fill screen SEEDS auto
  /// fields - today's date, the inspector's own name - the instant a template
  /// opens, so a draft judged by "are any answers non-blank" would be written
  /// for every template anybody merely looked at. The test is progress as the
  /// screen counted it, OR any photo or signature: a sheet whose only content
  /// so far is a photograph of a fault is still real work.
  Future<bool> draftHasContent({
    required String ownerKind,
    required String ownerKey,
    required int filled,
  }) async {
    if (filled > 0) {
      return true;
    }
    final photos =
        await (select(draftPhotos)
              ..where(
                (t) =>
                    t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
              )
              ..limit(1))
            .get();
    if (photos.isNotEmpty) {
      return true;
    }
    final signatures =
        await (select(capturedSignatures)
              ..where(
                (t) =>
                    t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
              )
              ..limit(1))
            .get();
    return signatures.isNotEmpty;
  }

  Future<List<String>> _discardDraft({
    required String ownerKind,
    required String ownerKey,
    required Future<void> Function() deleteHeader,
  }) async {
    return transaction(() async {
      final photos =
          await (select(draftPhotos)..where(
                (t) =>
                    t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
              ))
              .get();
      final List<String> paths = photos
          .map((DraftPhoto p) => p.localPath)
          .toList(growable: false);

      await (delete(draftPhotos)..where(
            (t) => t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
          ))
          .go();
      await (delete(capturedSignatures)..where(
            (t) => t.ownerKind.equals(ownerKind) & t.ownerKey.equals(ownerKey),
          ))
          .go();
      await deleteHeader();

      return paths;
    });
  }
}
