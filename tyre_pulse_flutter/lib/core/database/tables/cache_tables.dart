/// Local copies of server rows a technician standing at a machine needs to
/// look up. Artifact 05 sections 2.2 to 2.7.
///
/// Every table here carries `workspaceId` and a nullable `country`, and the
/// reason is not tidiness. The cache is a copy of rows the server released
/// under one RLS context. Change the active workspace and the server would
/// release a DIFFERENT set, but the local rows do not know which context
/// produced them. An unscoped `cached_assets` therefore serves company A's
/// fleet to a user who has just switched to company B, in a picker, with no
/// error and no way to tell - and the row they pick then goes into a command
/// naming an asset the new workspace has never heard of, and that command
/// syncs. The read looks like a caching bug; the write is a cross-tenant data
/// error.
///
/// `workspaceId` is therefore the FIRST column of every index here, so a query
/// that forgets the filter is also the slow query and shows up in testing.
///
/// The columns are declared explicitly on each table rather than shared
/// through a mixin. The repetition is deliberate: this file is audited against
/// artifact 05 column by column, and a reader must be able to see one table's
/// whole shape without following an inheritance chain.
library;

import 'package:drift/drift.dart';

/// Remote source: `profiles`. RECORDED size 38 rows, one request.
///
/// The signed-in user's OWN profile is deliberately not stored here. It lives
/// in `sync_metadata` under `profile.cached`, because it decides whether the
/// app opens at all, it is bounded by a different rule (90 days), and it must
/// be readable before any workspace is resolved. Mixing the two would make
/// opening the app depend on a table that only exists after a successful sync.
@DataClassName('CachedUser')
@TableIndex(name: 'idx_cached_users_scope', columns: {#workspaceId, #role})
@TableIndex(name: 'idx_cached_users_name', columns: {#workspaceId, #fullName})
class CachedUsers extends Table {
  /// `profiles.id`, the auth uid.
  TextColumn get id => text()();

  TextColumn get workspaceId => text()();
  TextColumn get country => text().nullable()();

  TextColumn get fullName => text().nullable()();
  TextColumn get username => text().nullable()();
  TextColumn get role => text().nullable()();

  /// Nullable on purpose: unknown is not false. A user whose approval state was
  /// never loaded must not render as "not approved".
  BoolColumn get approved => boolean().nullable()();

  /// Same reasoning as [approved].
  BoolColumn get locked => boolean().nullable()();

  /// JSON array, stored as received.
  TextColumn get sitesJson => text().nullable()();

  DateTimeColumn get cachedAt => dateTime()();

  @override
  String get tableName => 'cached_users';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Remote source: `sites` and the `reference_site_options` RPC. RECORDED size
/// 62 rows, one request.
@DataClassName('CachedSite')
@TableIndex(
  name: 'idx_cached_sites_scope',
  columns: {#workspaceId, #country, #name},
)
class CachedSites extends Table {
  TextColumn get id => text()();
  TextColumn get workspaceId => text()();
  TextColumn get country => text().nullable()();

  /// Stored verbatim as the server returns it.
  ///
  /// The server normalises site casing and applies aliases through triggers. A
  /// client that re-normalised would produce a value the server's own `.eq()`
  /// filters no longer match. The client compares; it does not canonicalise.
  TextColumn get name => text()();

  TextColumn get region => text().nullable()();
  BoolColumn get active => boolean().nullable()();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  String get tableName => 'cached_sites';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Remote source: `vehicle_fleet`, the most central table in the system.
/// RECORDED size 1,617 rows across three countries, 1,377 distinct codes.
///
/// This table is over the PostgREST 1000-row response cap, so filling it MUST
/// page. RECORDED: the truncation this caused read to users as "that asset was
/// never created", because the picker filters client-side and a code that was
/// never fetched simply has no match.
@DataClassName('CachedAsset')
@TableIndex(
  name: 'idx_cached_assets_identity',
  columns: {#workspaceId, #country, #assetNoNorm},
  unique: true,
)
@TableIndex(
  name: 'idx_cached_assets_lookup',
  columns: {#workspaceId, #assetNoNorm},
)
@TableIndex(
  name: 'idx_cached_assets_plate',
  columns: {#workspaceId, #registrationNo},
)
@TableIndex(
  name: 'idx_cached_assets_chassis',
  columns: {#workspaceId, #chassisNo},
)
@TableIndex(
  name: 'idx_cached_assets_site',
  columns: {#workspaceId, #country, #site},
)
class CachedAssets extends Table {
  /// `vehicle_fleet.id`.
  TextColumn get id => text()();

  TextColumn get workspaceId => text()();
  TextColumn get country => text().nullable()();

  /// The code a technician types or scans, verbatim from the server.
  TextColumn get assetNo => text()();

  /// Trimmed and uppercased, for lookup only.
  ///
  /// It exists so the scanner is an index seek. Matching on `UPPER(TRIM(...))`
  /// at query time cannot use an index and turns every keystroke into a full
  /// scan of 1,617 rows. Never send this form to the server - send [assetNo].
  TextColumn get assetNoNorm => text()();

  TextColumn get fleetNumber => text().nullable()();

  /// Plate. `vehicle_fleet.registration_no`.
  TextColumn get registrationNo => text().nullable()();

  TextColumn get chassisNo => text().nullable()();
  TextColumn get serialNo => text().nullable()();

  /// Drives the tyre diagram layout.
  TextColumn get vehicleType => text().nullable()();

  TextColumn get make => text().nullable()();
  TextColumn get model => text().nullable()();
  TextColumn get site => text().nullable()();

  /// Nullable, and it must stay nullable. RECORDED: `current_km` is set on a
  /// minority of assets, and a fabricated 0 would read as a real odometer.
  IntColumn get currentKm => integer().nullable()();

  /// Active or Inactive: is this machine on the current fleet.
  TextColumn get status => text().nullable()();

  /// What the machine is doing today. Distinct from [status]: a machine can be
  /// Active and broken down at the same time, and merging the two hides
  /// whichever question is being asked.
  TextColumn get opsStatus => text().nullable()();

  DateTimeColumn get cachedAt => dateTime()();

  @override
  String get tableName => 'cached_assets';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Remote source: `tyre_records`. RECORDED size 11,193 rows.
///
/// Deliberately NOT a full mirror. Eleven thousand rows of tyre history is both
/// a slow first sync on a field phone and mostly irrelevant: a technician needs
/// the tyres on the machine in front of them and the ones they looked up
/// recently. Populated on demand and pruned by count on [lastSeenAt].
@DataClassName('CachedTyre')
@TableIndex(
  name: 'idx_cached_tyres_asset',
  columns: {#workspaceId, #assetNo, #position},
)
@TableIndex(
  name: 'idx_cached_tyres_serial',
  columns: {#workspaceId, #serialNoNorm},
)
@TableIndex(name: 'idx_cached_tyres_prune', columns: {#lastSeenAt})
class CachedTyres extends Table {
  TextColumn get id => text()();
  TextColumn get workspaceId => text()();
  TextColumn get country => text().nullable()();

  /// Nullable: RECORDED, some rows carry no serial at all.
  TextColumn get serialNo => text().nullable()();

  /// Trimmed and uppercased. A LOOKUP aid that must never be written back.
  ///
  /// RECORDED: the server's `serial_no` is case-split - one real tyre's life is
  /// recorded half under `k507B403590` and half under `K507B403590` - and the
  /// recorded decision was explicitly NOT to normalise the column, because the
  /// barcode lookup is a case-sensitive `.eq()` and uppercasing it turns a
  /// split-history bug into a cannot-find-the-tyre bug in the field. So: search
  /// locally through this column to HELP the technician find the row, then send
  /// [serialNo] verbatim in any command.
  TextColumn get serialNoNorm => text().nullable()();

  TextColumn get assetNo => text().nullable()();

  /// Canonical GCC position label. Never re-derived on the client: AGENTS.md
  /// rule 10 forbids changing tyre position ids.
  TextColumn get position => text().nullable()();

  TextColumn get brand => text().nullable()();
  TextColumn get size => text().nullable()();

  /// Active / Removed / Scrapped.
  TextColumn get status => text().nullable()();

  /// Fitment.
  DateTimeColumn get issueDate => dateTime().nullable()();
  DateTimeColumn get removalDate => dateTime().nullable()();

  IntColumn get kmAtFitment => integer().nullable()();
  IntColumn get kmAtRemoval => integer().nullable()();
  IntColumn get totalKm => integer().nullable()();
  TextColumn get removalReason => text().nullable()();

  /// Drives count-based pruning. Touched every time the row is looked at, not
  /// every time it is refetched.
  DateTimeColumn get lastSeenAt => dateTime()();

  DateTimeColumn get cachedAt => dateTime()();

  @override
  String get tableName => 'cached_tyres';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Remote source: `checklist_templates`. RECORDED size 6 published templates.
@DataClassName('CachedChecklistTemplate')
@TableIndex(
  name: 'idx_templates_scope',
  columns: {#workspaceId, #country, #status},
)
class CachedChecklistTemplates extends Table {
  TextColumn get id => text()();
  TextColumn get workspaceId => text()();
  TextColumn get country => text().nullable()();

  TextColumn get name => text()();

  /// A draft is pinned to the version it was started on. If a supervisor
  /// publishes version 3 while a sheet filled against version 2 is still open,
  /// the answers were given against different questions, and a resume must warn
  /// rather than silently re-map them.
  IntColumn get version => integer()();

  /// Only `published` is fillable.
  TextColumn get status => text()();

  /// A token, resolved per platform. NOT a library-specific glyph name: a name
  /// valid in one icon library is meaningless to the other, which is the
  /// recorded cause of four templates rendering a blank square.
  TextColumn get icon => text().nullable()();

  TextColumn get category => text().nullable()();

  /// The field definitions, stored verbatim rather than parsed into child
  /// tables.
  ///
  /// They carry conditional logic, shared option references and per-language
  /// labels. Splitting them relationally would mean re-implementing the
  /// server's own document shape and drifting from it on the next template
  /// edit. The one thing that must be relational is a filled ANSWER.
  TextColumn get fieldsJson => text()();

  /// JSON array, stored exactly as received.
  ///
  /// **Null and empty are different and must stay different.** Null means the
  /// template is for everyone; an empty array reads as "targeted at nobody". A
  /// mapper that coalesces null to `[]` hides every checklist from the whole
  /// fleet.
  TextColumn get assigneeRolesJson => text().nullable()();

  BoolColumn get requireSignature => boolean()();
  BoolColumn get requireApproval => boolean()();
  IntColumn get minIntervalDays => integer().nullable()();

  DateTimeColumn get cachedAt => dateTime()();

  @override
  String get tableName => 'cached_checklist_templates';

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Remote source: `user_access_grants`, plus the role default matrix.
/// Artifact 05 section 2.7.
///
/// Without a cached copy, the navigation an offline user sees would be whatever
/// the last render happened to leave in memory.
///
/// **Mobile module keys are NOT web module keys.** RECORDED: writing `mobile:`
/// in front of a WEB key produced 68 permission rows that gated nothing,
/// because the phone reads its own key (`records`, not `tyre_records`). Only
/// the mobile registry belongs in this table.
@DataClassName('CachedPermission')
@TableIndex(name: 'idx_permissions_user', columns: {#userId, #workspaceId})
class CachedPermissions extends Table {
  TextColumn get userId => text()();

  /// The MOBILE module key, e.g. `records`, `inspect`.
  TextColumn get moduleKey => text()();

  TextColumn get workspaceId => text()();

  /// `grant` or `revoke`, per PermissionEffect. A revoke always beats a
  /// grant.
  TextColumn get effect => text()();

  /// Default `view` at the repository boundary, not in SQL: a capability that
  /// arrives absent from the server is a data problem worth seeing, not
  /// something to paper over with a column default.
  TextColumn get capability => text()();

  /// An expired grant is not applied.
  DateTimeColumn get expiresAt => dateTime().nullable()();

  DateTimeColumn get cachedAt => dateTime()();

  @override
  String get tableName => 'cached_permissions';

  @override
  Set<Column<Object>> get primaryKey => {userId, moduleKey};
}
