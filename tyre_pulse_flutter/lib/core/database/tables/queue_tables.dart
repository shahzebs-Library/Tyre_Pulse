/// The offline command queue and its evidence. Artifact 05 sections 2.12 to
/// 2.14, and artifact 06.
///
/// These are real tables with real rows, and that is the point. The React
/// Native queues are ONE JSON blob rewritten in full on every change, which
/// means every badge read deserialises the whole queue, two writers must be
/// serialised by hand, and a single corrupt entry threatens every other entry.
/// Worse, an empty read meant two different things - "nothing is queued" and
/// "the Keystore refused" - and ten callers then SAVED what they had read, so
/// one bad read replaced a worker's unsynced inspections with an empty list,
/// silently, with the only copy on that device.
///
/// Modelling this relationally makes both problems structurally impossible
/// rather than a convention somebody has to remember. There must be no code
/// path anywhere that serialises a whole collection and writes it back.
library;

import 'package:drift/drift.dart';

/// One queued write. Artifact 05 section 2.12.
///
/// There is deliberately no separate `pending_inspections` table. The React
/// Native app has two queues only because the inspection queue was written
/// first; there is no behavioural difference worth two implementations. An
/// inspection is a command like any other, with its photos in
/// `pending_media_uploads` and its marks in `captured_signatures`. One queue,
/// one sync engine, one lock.
@DataClassName('PendingCommand')
@TableIndex(name: 'idx_commands_due', columns: {#status, #nextRetryAt})
@TableIndex(name: 'idx_commands_pending_count', columns: {#status})
@TableIndex(name: 'idx_commands_idem', columns: {#idempotencyKey}, unique: true)
@TableIndex(name: 'idx_commands_workspace', columns: {#workspaceId, #status})
class PendingCommands extends Table {
  /// Local UUID, minted when the user commits the form.
  TextColumn get id => text()();

  /// One of the command types in the registry. The registry is the ONLY place
  /// a table name may appear on the client.
  TextColumn get commandType => text()();

  /// The target table, derived from the registry and never client-chosen.
  TextColumn get entityType => text()();

  /// The match value for an update command; null for an insert. An update
  /// command excludes the match column from its SET clause, so the primary key
  /// is never rewritten.
  TextColumn get entityId => text().nullable()();

  /// The payload, ALREADY stripped to the command's field allow-list. A column
  /// PostgREST cannot find fails the WHOLE request, so one stray key would kill
  /// a field worker's entire sync.
  TextColumn get payloadJson => text()();

  DateTimeColumn get createdAt => dateTime()();

  /// Who captured this. The React Native queue does not record it, which makes
  /// a shared-handset queue unattributable.
  TextColumn get createdBy => text()();

  /// Which workspace this was captured in. This column is a REFUSAL, not a
  /// filter.
  ///
  /// The React Native queue does not record it, so a sync running after a
  /// workspace switch would push the command under whatever context is now
  /// active. That is a cross-tenant write. The rule here: if this does not
  /// match the active workspace the row is set `blocked` and reported as
  /// "captured in another workspace" - never pushed, and never discarded.
  TextColumn get workspaceId => text()();

  TextColumn get country => text().nullable()();

  IntColumn get retryCount => integer().withDefault(const Constant(0))();

  /// When this row becomes due. Backoff is `30s * 2^retry` capped at 30
  /// minutes.
  DateTimeColumn get nextRetryAt => dateTime()();

  /// One of CommandStatus: pending, processing, retry, blocked, failed, synced.
  TextColumn get status => text()();

  /// Sanitised before storage, not before display. A raw database message must
  /// never land on disk at all, so it cannot leak later through a log export or
  /// a support screenshot.
  TextColumn get lastError => text().nullable()();

  /// The stable client id shared by the immediate attempt AND every queued
  /// retry, so a lost response or a crash can never create a duplicate.
  ///
  /// Minted ONCE, before the first network attempt, and written in the SAME
  /// transaction as the payload. A key minted only on the fallback path means
  /// the online attempt and the queued retry carry different keys, which is the
  /// exact double-insert the mechanism exists to prevent.
  TextColumn get idempotencyKey => text()();

  DateTimeColumn get syncedAt => dateTime().nullable()();

  /// Another `pending_commands.id` that must reach `synced` first. Spec section
  /// 15 requires processing by dependency order.
  ///
  /// Deliberately NOT a declared foreign key: a synced predecessor is pruned
  /// while its dependent may still be queued, and a FK would either block that
  /// prune or cascade-delete unsynced work. The dependency is resolved by the
  /// queue DAO, which treats a missing predecessor as already satisfied.
  TextColumn get dependsOn => text().nullable()();

  @override
  String get tableName => 'pending_commands';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// A photo waiting to be uploaded and then confirmed. Artifact 05 section 2.13.
///
/// **The name is a deliberate departure from spec section 11, which calls this
/// `pending_uploads`.** `pending_uploads` is ALREADY a real REMOTE table - the
/// admin approval queue, with its own `approve_pending_upload` and
/// `reject_pending_upload` RPCs. A local table of the same name would produce a
/// repository whose name means two different things in two files, which is
/// precisely how the previous rebuild drifted.
@DataClassName('PendingMediaUpload')
@TableIndex(
  name: 'idx_media_command',
  columns: {#commandId, #fieldKey, #orderIndex},
)
@TableIndex(name: 'idx_media_state', columns: {#state, #attempts})
@TableIndex(name: 'idx_media_file', columns: {#fileName}, unique: true)
class PendingMediaUploads extends Table {
  TextColumn get id => text()();

  /// ON DELETE RESTRICT rather than CASCADE, and that is the whole point.
  ///
  /// A command row cannot be deleted while media rows still reference it, so
  /// the pruner physically cannot remove the queue entry that is the only thing
  /// keeping a photo's file alive. The deletion order is forced: verify the
  /// media, delete the media rows and their files, then delete the command.
  ///
  /// This is inert without `PRAGMA foreign_keys = ON`, which the database's
  /// `beforeOpen` sets on every connection.
  TextColumn get commandId =>
      text().references(PendingCommands, #id, onDelete: KeyAction.restrict)();

  /// Checklist field id, or tyre position, or null for a flat list. Photos are
  /// a keyed MAP for checklists and a flat ARRAY elsewhere; code that assumes
  /// one shape silently skips the other.
  TextColumn get fieldKey => text().nullable()();

  /// Position within its field. Rebuilding the keyed map in the right order
  /// depends on this.
  IntColumn get orderIndex => integer()();

  /// Absolute `file://` path in the queue media folder. Never a path in the OS
  /// cache directory: Android and iOS may purge that at any moment, so a queue
  /// that merely remembered the camera's path would come back holding dead
  /// URIs. Copy first, enqueue second.
  TextColumn get localPath => text()();

  /// Basename, for iOS container healing and for the sweep. Unique, which is
  /// what turns the orphan sweep into a join instead of a directory listing
  /// compared against an in-memory set.
  TextColumn get fileName => text()();

  IntColumn get sizeBytes => integer().nullable()();
  TextColumn get mimeType => text().nullable()();

  /// MD5 where readable, else `size:mtime`.
  TextColumn get checksum => text().nullable()();

  /// `tyre-photos` or `accident-photos`.
  TextColumn get bucket => text().nullable()();

  TextColumn get remotePath => text().nullable()();

  /// `tp-storage://<bucket>/<path>`.
  TextColumn get remoteRef => text().nullable()();

  /// One of MediaUploadState. The local file may only be deleted in
  /// `verified`.
  TextColumn get state => text()();

  IntColumn get attempts => integer().withDefault(const Constant(0))();

  TextColumn get lastError => text().nullable()();

  DateTimeColumn get capturedAt => dateTime()();
  DateTimeColumn get uploadedAt => dateTime().nullable()();

  @override
  String get tableName => 'pending_media_uploads';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// A dead-letter record. Artifact 05 section 2.14.
///
/// Kept separately from `pending_commands` so that clearing the queue never
/// erases the evidence of why something did not sync.
@DataClassName('SyncFailure')
@TableIndex(name: 'idx_failures_recent', columns: {#occurredAt})
class SyncFailures extends Table {
  TextColumn get id => text()();

  /// Nullable: the command row may have been cleared. There is deliberately no
  /// foreign key, so the diagnosis outlives the thing it diagnoses.
  TextColumn get commandId => text().nullable()();

  TextColumn get commandType => text().nullable()();
  TextColumn get entityType => text().nullable()();
  TextColumn get workspaceId => text().nullable()();

  DateTimeColumn get occurredAt => dateTime()();
  IntColumn get attempt => integer()();

  /// PostgREST or Postgres code where available.
  TextColumn get errorCode => text().nullable()();

  /// One of SyncErrorClass. This, and never the message text, decides whether a
  /// retry happens.
  TextColumn get errorClass => text()();

  /// Sanitised at WRITE time, not at display time, so a raw database message
  /// never lands on disk and cannot leak later through a log export or a
  /// support screenshot.
  TextColumn get messageSafe => text().nullable()();

  /// What was attempted.
  TextColumn get payloadSnapshotJson => text().nullable()();

  @override
  String get tableName => 'sync_failures';

  @override
  Set<Column<Object>> get primaryKey => {id};
}
