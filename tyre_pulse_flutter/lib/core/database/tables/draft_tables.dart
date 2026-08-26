/// Part-filled work that exists ONLY on this device. Artifact 05 sections 2.8
/// to 2.11.
///
/// The inspection draft is the single biggest data-loss risk the audit found,
/// and it is live today: the React Native inspection capture screen contains
/// zero references to a draft store, so a part-filled inspection - the asset,
/// the meter reading and up to 13 tyre positions each with a condition and a
/// photo - exists only in React state until submit. Backgrounding the app and
/// letting Android reclaim the process loses all of it silently. The CHECKLIST
/// got draft preservation; the INSPECTION did not.
///
/// Nothing in this file ever reaches the server as a draft. A draft is never a
/// row in `checklist_submissions`: the server mints the document number
/// (`WDC-TM514-2026-0001`) from a per (org, prefix, asset, year) counter on
/// BEFORE INSERT, deliberately so an abandoned fill never burns one, and a
/// server-side draft row would gap a numbered document register permanently.
/// The first time a sheet reaches the database is still the submit.
library;

import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';

/// The header of an in-progress inspection.
///
/// The primary key is `userId|assetNo` normalised, and each part earns its
/// place. The user part keeps two people apart on a shared handset - and that
/// is load-bearing rather than theoretical, because sign-out deliberately
/// preserves unsynced work, so a handset genuinely can hold two people's drafts
/// at once. The normalised asset part treats `tm514`, `TM514` and ` TM514 ` as
/// one sheet; without it the operator finishes one of three drafts of the same
/// job.
@DataClassName('InspectionDraft')
@TableIndex(
  name: 'idx_inspection_drafts_user',
  columns: {#userId, #updatedAt},
)
class InspectionDrafts extends Table {
  /// `userId|ASSETNO`. Built by the repository, never by a screen.
  TextColumn get draftKey => text()();

  TextColumn get userId => text()();

  /// Which tenant this work was captured in, so a sync running under a
  /// switched workspace can refuse to push it rather than write it into the
  /// wrong tenant.
  TextColumn get workspaceId => text()();

  TextColumn get country => text().nullable()();

  /// Normalised, uppercase.
  TextColumn get assetNo => text()();

  /// Pins the diagram layout at fill time, so a later change to the asset
  /// record cannot silently re-shape a half-filled sheet.
  TextColumn get vehicleType => text().nullable()();

  TextColumn get site => text().nullable()();
  TextColumn get inspectorName => text().nullable()();

  /// Nullable. Zero IS a reading and must not be conflated with absent: an
  /// asset genuinely at 0 km and an asset nobody read are different facts.
  IntColumn get odometerKm => integer().nullable()();

  /// Same reasoning as [odometerKm].
  RealColumn get engineHours => real().nullable()();

  TextColumn get findings => text().nullable()();

  /// Progress as the SCREEN counted it, over fields a person can actually
  /// record. Never re-derived here: the screen knows which fields are visible
  /// under the current conditional logic and this table does not.
  IntColumn get filled => integer()();

  IntColumn get total => integer()();

  DateTimeColumn get createdAt => dateTime()();

  /// Sort key for the unfinished-work list and the source of its "last saved"
  /// line.
  DateTimeColumn get updatedAt => dateTime()();

  @override
  String get tableName => 'inspection_drafts';

  @override
  Set<Column<Object>> get primaryKey => {draftKey};
}

/// One row per tyre position on an in-progress inspection.
///
/// A child table rather than a `tyreConditionsJson` column because spec section
/// 27 requires the app to show EXACTLY what is missing before submit, and that
/// question is "which of this vehicle's positions has no row, and which has a
/// row with no evidence". Both are one indexed query here, and a full
/// deserialise plus loop over a blob otherwise, on a screen that re-evaluates
/// on every tap.
@DataClassName('InspectionDraftPosition')
@TableIndex(
  name: 'idx_draft_position',
  columns: {#draftKey, #position},
  unique: true,
)
class InspectionDraftPositions extends Table {
  TextColumn get id => text()();

  TextColumn get draftKey => text().references(
        InspectionDrafts,
        #draftKey,
        onDelete: KeyAction.cascade,
      )();

  /// Canonical label, e.g. `LHF1`. AGENTS.md rule 10: never change a tyre
  /// position id.
  TextColumn get position => text()();

  /// Good / Worn / Flat / Damaged / Puncture / Wear.
  TextColumn get condition => text().nullable()();

  /// Nullable, and zero is a FLAT TYRE rather than "no reading". A truthiness
  /// check here throws away the most important reading on the screen.
  RealColumn get pressurePsi => real().nullable()();

  RealColumn get treadDepthMm => real().nullable()();
  TextColumn get serialNo => text().nullable()();

  /// Was this wheel deliberately attended to, as opposed to pre-seeded.
  ///
  /// It defaults to FALSE and that default is the whole point. RECORDED: both
  /// capture forms pre-seed every wheel with `condition: 'Good'`, so a seeded
  /// Good and a deliberate Good are byte-identical and no completeness rule can
  /// tell them apart. The single write path for a tyre edit stamps this true.
  /// Only an explicit true counts. Getting it wrong makes the completeness gate
  /// either vacuous or a refusal of one inspection in four.
  BoolColumn get checked => boolean().withDefault(const Constant(false))();

  DateTimeColumn get updatedAt => dateTime()();

  @override
  String get tableName => 'inspection_draft_positions';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// A part-filled checklist. A direct port of the React Native draft store's
/// rules, without its single-JSON-blob storage.
@DataClassName('ChecklistDraft')
@TableIndex(name: 'idx_checklist_drafts_user', columns: {#userId, #updatedAt})
@TableIndex(
  name: 'idx_checklist_drafts_resume',
  columns: {#userId, #templateId, #assetNo},
)
class ChecklistDrafts extends Table {
  /// `userId|templateId|ASSETNO`.
  ///
  /// An empty asset is a legitimate key component: a sheet started before a
  /// machine is picked gets its own slot, and when the operator picks one the
  /// row is rekeyed and the old key discarded.
  TextColumn get draftKey => text()();

  TextColumn get userId => text()();
  TextColumn get workspaceId => text()();
  TextColumn get templateId => text()();

  /// Denormalised so the unfinished-work list renders with no signal.
  TextColumn get templateName => text()();

  /// The version pin. A resume against a changed version must warn rather than
  /// silently re-map answers given to different questions.
  IntColumn get templateVersion => integer()();

  /// Normalised. Empty string until a machine is picked.
  TextColumn get assetNo => text()();

  TextColumn get assignmentId => text().nullable()();
  TextColumn get site => text().nullable()();
  TextColumn get title => text().nullable()();

  /// So a resumed sheet reads in the same language it was started in.
  TextColumn get readLang => text().nullable()();

  /// Answers keyed by field id.
  TextColumn get answersJson => text()();

  /// Per-line remarks keyed by field id. A failed check recorded with no reason
  /// renders as an empty Remarks column, indistinguishable from "nothing to
  /// report".
  TextColumn get notesJson => text()();

  TextColumn get printedName => text().nullable()();

  /// Counted by the screen, never re-derived here. See
  /// [InspectionDrafts.filled].
  IntColumn get filled => integer()();

  IntColumn get total => integer()();

  /// Preserved across later saves. An upsert must not reset it.
  DateTimeColumn get createdAt => dateTime()();

  DateTimeColumn get updatedAt => dateTime()();

  @override
  String get tableName => 'checklist_drafts';

  @override
  Set<Column<Object>> get primaryKey => {draftKey};
}

/// Photos belonging to a draft. Artifact 05 section 2.10.
///
/// A separate table from `pending_media_uploads` because the two have different
/// lifecycles, and merging them is the exact recorded trap: the queue sweep
/// deletes every file in the queue folder that no live QUEUE entry references,
/// a draft is not a queue entry, and a previous attempt at draft photos wrote
/// them into the queue folder and had to be reverted because the next sync
/// deleted the operator's evidence.
///
/// [ownerKind] is polymorphic across two draft tables, so SQLite cannot express
/// this relationship as a declared foreign key. The cascade is performed by the
/// drafts DAO instead, in the same transaction that discards the draft.
@DataClassName('DraftPhoto')
@TableIndex(name: 'idx_draft_photos_owner', columns: {#ownerKind, #ownerKey})
@TableIndex(name: 'idx_draft_photos_file', columns: {#fileName}, unique: true)
class DraftPhotos extends Table {
  TextColumn get id => text()();

  /// `checklist_draft` or `inspection_draft`. See OwnerKind.draftOwners.
  TextColumn get ownerKind => text()();

  /// The owning `draftKey`.
  TextColumn get ownerKey => text()();

  /// Checklist field id, or the tyre position.
  TextColumn get fieldKey => text().nullable()();

  /// Absolute `file://` path inside the draft media folder.
  TextColumn get localPath => text()();

  /// Basename, stored separately from [localPath] on purpose.
  ///
  /// iOS rewrites the document container path between launches, so an absolute
  /// path stored yesterday can be stale while the file is perfectly intact. The
  /// heal is to look for the same basename in the CURRENT folder, and a column
  /// makes that a lookup instead of a string operation on every restore. It is
  /// also the sweep key, which is why it is unique.
  TextColumn get fileName => text()();

  IntColumn get sizeBytes => integer().nullable()();
  TextColumn get mimeType => text().nullable()();

  /// MD5 where readable, else `size:mtime`.
  TextColumn get checksum => text().nullable()();

  DateTimeColumn get capturedAt => dateTime()();

  @override
  String get tableName => 'draft_photos';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// A captured signature. Artifact 05 section 2.11 and section 5.
///
/// The unique index on (ownerKind, ownerKey, fieldKey) IS the fix for a
/// recorded defect: a single global slot meant three trades signing a workshop
/// sheet overwrote one another, only the last reached the database, and every
/// signature tile read "signed" once any one was.
@DataClassName('CapturedSignature')
@TableIndex(
  name: 'idx_signature_slot',
  columns: {#ownerKind, #ownerKey, #fieldKey},
  unique: true,
)
class CapturedSignatures extends Table {
  TextColumn get id => text()();

  /// `checklist_draft`, `inspection_draft` or `pending_command`. There is no
  /// `approval` kind: an approver's mark goes straight to the RPC while online
  /// and is never persisted, because a signature waiting in a local table to
  /// approve something is a decision queued offline.
  TextColumn get ownerKind => text()();

  TextColumn get ownerKey => text()();

  /// The form field id, or the reserved `__primary__` for the template-level
  /// pad. Deliberately NOT nullable: SQLite treats NULLs as distinct in a
  /// unique index, so a nullable key would quietly restore the shared slot.
  TextColumn get fieldKey => text()();

  /// `svg` or `dataurl`. Anything else is not a mark this app draws.
  TextColumn get format => text()();

  /// The mark itself, length-capped to mirror `user_signatures_len_chk`. A
  /// value the server column would refuse is refused here at capture time with
  /// a message, rather than at sync time with a failure.
  TextColumn get payload => text().withLength(max: signatureMaxLength)();

  /// Vector points, when the pad captured them. SVG markup reconstructs the
  /// picture; the raw strokes reconstruct the ACT, which is what makes a mark
  /// defensible if it is ever disputed. Nullable, because a mark restored from
  /// a saved signature has no strokes: it was drawn on another day, possibly on
  /// another device.
  TextColumn get strokesJson => text().nullable()();

  TextColumn get signerUserId => text().nullable()();
  TextColumn get signerName => text().nullable()();
  TextColumn get signerRole => text().nullable()();

  /// `drawn`, `saved` or `none`. Carried into the record so an audit can answer
  /// later where the mark came from.
  TextColumn get source => text()();

  DateTimeColumn get signedAt => dateTime()();

  @override
  String get tableName => 'captured_signatures';

  @override
  Set<Column<Object>> get primaryKey => {id};
}
