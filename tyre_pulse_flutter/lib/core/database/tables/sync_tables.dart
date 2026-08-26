/// Device-local bookkeeping. Artifact 05 sections 2.15 and 2.16.
library;

import 'package:drift/drift.dart';

/// Key-value, one row per named fact.
///
/// A table rather than a preferences file because these values must be read and
/// written inside the SAME transaction as the rows they describe. A cache
/// timestamp written outside the transaction that filled the cache is a
/// timestamp that can be true about a cache that does not exist.
///
/// `cache.<table>.truncated` is the reason this is a table and not a log line:
/// a paged read that hit its ceiling produced a cache that is silently short,
/// and a silently short list reads to a user as "that asset was never created".
/// The flag travels with the cache so the picker can say "showing 1,000 of
/// 1,617" instead of lying by omission.
@DataClassName('SyncMetadataEntry')
class SyncMetadata extends Table {
  /// Built by SyncMetadataKeys, never typed at a call site: a near-miss
  /// spelling reads back as absent, which is indistinguishable from "never
  /// synced".
  TextColumn get key => text()();

  /// Null for device-wide facts.
  TextColumn get workspaceId => text().nullable()();

  TextColumn get valueJson => text()();

  DateTimeColumn get updatedAt => dateTime()();

  @override
  String get tableName => 'sync_metadata';

  @override
  Set<Column<Object>> get primaryKey => {key};
}

/// Recent searches, per user. Spec section 34.
///
/// Per USER, not per device, and cleared on sign-out: a shared handset must not
/// show the next technician what the previous one looked up.
///
/// A row records what was SEARCHED, never a permission. A recents list that
/// replayed an allow could hand back access after a grant was withdrawn; here
/// the row carries a term and an id, and whether that record is still readable
/// is re-decided by the server on the next open.
@DataClassName('RecentSearch')
@TableIndex(
  name: 'idx_recent_dedupe',
  columns: {#userId, #workspaceId, #termNorm},
  unique: true,
)
@TableIndex(
  name: 'idx_recent_list',
  columns: {#userId, #workspaceId, #searchedAt},
)
class RecentSearches extends Table {
  TextColumn get id => text()();
  TextColumn get userId => text()();
  TextColumn get workspaceId => text()();

  /// As typed.
  TextColumn get term => text()();

  /// Trimmed and uppercased, for dedupe only. Searching the same thing twice
  /// updates the timestamp; it does not add a second row.
  TextColumn get termNorm => text()();

  /// `asset`, `tyre`, `work_order`, `accident` or `inspection`.
  TextColumn get resultKind => text().nullable()();

  /// What was opened, so a repeat is one tap.
  TextColumn get resultId => text().nullable()();

  DateTimeColumn get searchedAt => dateTime()();

  @override
  String get tableName => 'recent_searches';

  @override
  Set<Column<Object>> get primaryKey => {id};
}
