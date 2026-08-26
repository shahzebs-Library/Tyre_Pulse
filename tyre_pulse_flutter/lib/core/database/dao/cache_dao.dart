/// Reads and writes for the offline cache, the workspace context and the
/// device's own bookkeeping.
///
/// **Every read of cached business data in this file goes through
/// [scopeWhere].** There is no unscoped read and there is no second copy of the
/// scope predicate. That is the enforcement for artifact 05 section 2.0: a
/// repository that forgets the workspace filter serves company A's fleet to
/// somebody who has just switched to company B, in a picker, with no error and
/// no way to tell - and the row they pick then goes into a command naming an
/// asset the new workspace has never heard of.
///
/// The WRITE side is guarded too. A caller that hands over rows stamped with
/// the wrong workspace is refused rather than trusted, because a cache poisoned
/// on the way in cannot be filtered clean on the way out.
library;

import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/database/tables/cache_tables.dart';
import 'package:tyre_pulse/core/database/tables/sync_tables.dart';
import 'package:tyre_pulse/core/database/tables/workspace_tables.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:uuid/uuid.dart';

part 'cache_dao.g.dart';

/// The cached copy of server data, plus the workspace context that scopes it.
@DriftAccessor(
  tables: <Type>[
    WorkspaceScopes,
    CachedUsers,
    CachedSites,
    CachedAssets,
    CachedTyres,
    CachedChecklistTemplates,
    CachedPermissions,
    RecentSearches,
    SyncMetadata,
  ],
)
class CacheDao extends DatabaseAccessor<AppDatabase> with _$CacheDaoMixin {
  CacheDao(super.attachedDatabase);

  static const Uuid _uuid = Uuid();

  // -- Workspace context ----------------------------------------------------

  /// The workspace every scoped read runs under. Null means no context has been
  /// established yet, which is a real state and not an error.
  Future<WorkspaceScopeRow?> activeWorkspace() {
    return (select(workspaceScopes)
          ..where((t) => t.isActive.equals(true))
          ..limit(1))
        .getSingleOrNull();
  }

  Future<List<WorkspaceScopeRow>> allWorkspaces() =>
      select(workspaceScopes).get();

  Future<void> upsertWorkspace(WorkspaceScopesCompanion row) async {
    await into(workspaceScopes).insertOnConflictUpdate(row);
  }

  /// Makes exactly one workspace active, in one transaction.
  ///
  /// Two rows marked active would make "which workspace am I in" answerable two
  /// ways, and every scoped read would then depend on which row the query
  /// happened to return first.
  Future<void> setActiveWorkspace(String workspaceId) async {
    await transaction(() async {
      await update(workspaceScopes)
          .write(const WorkspaceScopesCompanion(isActive: Value<bool>(false)));
      await (update(workspaceScopes)
            ..where((t) => t.workspaceId.equals(workspaceId)))
          .write(const WorkspaceScopesCompanion(isActive: Value<bool>(true)));
    });
  }

  // -- Assets ---------------------------------------------------------------

  /// Replaces this scope's asset cache in one transaction.
  ///
  /// Only the rows the same scope could have produced are removed, so a refresh
  /// under a country narrowing cannot silently drop another country's cached
  /// rows.
  ///
  /// [truncated] must be told the truth. A paged read that hit its ceiling
  /// produced a cache that is silently short, and a silently short list reads
  /// to a user as "that asset was never created". The flag travels with the
  /// cache so the picker can say "showing 1,000 of 1,617" instead of lying by
  /// omission.
  Future<void> replaceAssets({
    required WorkspaceScopeFilter scope,
    required List<CachedAssetsCompanion> rows,
    required DateTime now,
    bool truncated = false,
  }) async {
    _requireScopedRows(
      rows.map((CachedAssetsCompanion r) => r.workspaceId),
      scope,
      'cached_assets',
    );

    await transaction(() async {
      await (delete(
        cachedAssets,
      )..where((t) => scopeWhere(scope, t.workspaceId, t.country))).go();
      await batch((Batch b) => b.insertAll(cachedAssets, rows));
      await _recordCacheSync(
        table: 'cached_assets',
        scope: scope,
        rowCount: rows.length,
        truncated: truncated,
        now: now,
      );
    });
  }

  /// Resolves a typed or scanned asset code.
  ///
  /// Matches on the normalised column so this is an index seek. Comparing
  /// `UPPER(TRIM(assetNo))` at query time cannot use an index and turns every
  /// keystroke into a full scan of 1,617 rows.
  Future<CachedAsset?> assetByCode({
    required WorkspaceScopeFilter scope,
    required String code,
  }) {
    final String normalised = normaliseLookupKey(code);
    if (normalised.isEmpty) {
      return Future<CachedAsset?>.value();
    }
    return (select(cachedAssets)
          ..where(
            (t) =>
                scopeWhere(scope, t.workspaceId, t.country) &
                t.assetNoNorm.equals(normalised),
          )
          ..limit(1))
        .getSingleOrNull();
  }

  /// The asset picker's list. An empty [term] returns the head of the scope's
  /// fleet rather than nothing, because a picker that shows nothing until you
  /// type is a picker a technician cannot browse.
  Future<List<CachedAsset>> searchAssets({
    required WorkspaceScopeFilter scope,
    String term = '',
    int limit = 50,
  }) {
    final String normalised = normaliseLookupKey(term);
    return (select(cachedAssets)
          ..where((t) {
            final Expression<bool> scoped = scopeWhere(
              scope,
              t.workspaceId,
              t.country,
            );
            if (normalised.isEmpty) {
              return scoped;
            }
            return scoped &
                (t.assetNoNorm.like('%$normalised%') |
                    t.registrationNo.like('%$normalised%') |
                    t.chassisNo.like('%$normalised%'));
          })
          ..orderBy([(t) => OrderingTerm.asc(t.assetNoNorm)])
          ..limit(limit))
        .get();
  }

  /// "Assets at my site", the default picker view.
  Future<List<CachedAsset>> assetsAtSite({
    required WorkspaceScopeFilter scope,
    required String site,
    int limit = 200,
  }) {
    return (select(cachedAssets)
          ..where(
            (t) =>
                scopeWhere(scope, t.workspaceId, t.country) &
                t.site.equals(site),
          )
          ..orderBy([(t) => OrderingTerm.asc(t.assetNoNorm)])
          ..limit(limit))
        .get();
  }

  // -- Sites, users, templates ---------------------------------------------

  Future<void> replaceSites({
    required WorkspaceScopeFilter scope,
    required List<CachedSitesCompanion> rows,
    required DateTime now,
    bool truncated = false,
  }) async {
    _requireScopedRows(
      rows.map((CachedSitesCompanion r) => r.workspaceId),
      scope,
      'cached_sites',
    );
    await transaction(() async {
      await (delete(
        cachedSites,
      )..where((t) => scopeWhere(scope, t.workspaceId, t.country))).go();
      await batch((Batch b) => b.insertAll(cachedSites, rows));
      await _recordCacheSync(
        table: 'cached_sites',
        scope: scope,
        rowCount: rows.length,
        truncated: truncated,
        now: now,
      );
    });
  }

  Future<List<CachedSite>> sites(WorkspaceScopeFilter scope) {
    return (select(cachedSites)
          ..where((t) => scopeWhere(scope, t.workspaceId, t.country))
          ..orderBy([(t) => OrderingTerm.asc(t.name)]))
        .get();
  }

  Future<void> replaceUsers({
    required WorkspaceScopeFilter scope,
    required List<CachedUsersCompanion> rows,
    required DateTime now,
    bool truncated = false,
  }) async {
    _requireScopedRows(
      rows.map((CachedUsersCompanion r) => r.workspaceId),
      scope,
      'cached_users',
    );
    await transaction(() async {
      await (delete(
        cachedUsers,
      )..where((t) => scopeWhere(scope, t.workspaceId, t.country))).go();
      await batch((Batch b) => b.insertAll(cachedUsers, rows));
      await _recordCacheSync(
        table: 'cached_users',
        scope: scope,
        rowCount: rows.length,
        truncated: truncated,
        now: now,
      );
    });
  }

  /// The approver picker and the "who signs" screens.
  Future<List<CachedUser>> usersByRole({
    required WorkspaceScopeFilter scope,
    String? role,
  }) {
    return (select(cachedUsers)
          ..where((t) {
            final Expression<bool> scoped = scopeWhere(
              scope,
              t.workspaceId,
              t.country,
            );
            if (role == null) {
              return scoped;
            }
            return scoped & t.role.equals(role);
          })
          ..orderBy([(t) => OrderingTerm.asc(t.fullName)]))
        .get();
  }

  Future<void> replaceChecklistTemplates({
    required WorkspaceScopeFilter scope,
    required List<CachedChecklistTemplatesCompanion> rows,
    required DateTime now,
    bool truncated = false,
  }) async {
    _requireScopedRows(
      rows.map((CachedChecklistTemplatesCompanion r) => r.workspaceId),
      scope,
      'cached_checklist_templates',
    );
    await transaction(() async {
      await (delete(
        cachedChecklistTemplates,
      )..where((t) => scopeWhere(scope, t.workspaceId, t.country))).go();
      await batch((Batch b) => b.insertAll(cachedChecklistTemplates, rows));
      await _recordCacheSync(
        table: 'cached_checklist_templates',
        scope: scope,
        rowCount: rows.length,
        truncated: truncated,
        now: now,
      );
    });
  }

  /// Only `published` templates are fillable.
  ///
  /// Role targeting is deliberately NOT applied here. `assigneeRolesJson` is
  /// stored as received because null means "for everyone" and an empty array
  /// means "for nobody", and those must stay distinguishable; deciding which
  /// applies is a domain rule, not a SQL predicate.
  Future<List<CachedChecklistTemplate>> publishedTemplates(
    WorkspaceScopeFilter scope,
  ) {
    return (select(cachedChecklistTemplates)
          ..where(
            (t) =>
                scopeWhere(scope, t.workspaceId, t.country) &
                t.status.equals('published'),
          )
          ..orderBy([(t) => OrderingTerm.asc(t.name)]))
        .get();
  }

  // -- Tyres ----------------------------------------------------------------

  /// Adds or refreshes tyres fetched on demand, then trims to the count cap.
  ///
  /// `cached_tyres` is not a mirror. Eleven thousand rows of tyre history is a
  /// slow first sync on a field phone and mostly irrelevant: a technician needs
  /// the tyres on the machine in front of them and the ones they looked up
  /// recently.
  Future<void> upsertTyres({
    required WorkspaceScopeFilter scope,
    required List<CachedTyresCompanion> rows,
  }) async {
    _requireScopedRows(
      rows.map((CachedTyresCompanion r) => r.workspaceId),
      scope,
      'cached_tyres',
    );
    await transaction(() async {
      await batch((Batch b) => b.insertAllOnConflictUpdate(cachedTyres, rows));
      await pruneTyresToCap();
    });
  }

  /// The tyre bay view: every tyre on this machine, by position.
  Future<List<CachedTyre>> tyresForAsset({
    required WorkspaceScopeFilter scope,
    required String assetNo,
  }) {
    return (select(cachedTyres)
          ..where(
            (t) =>
                scopeWhere(scope, t.workspaceId, t.country) &
                t.assetNo.equals(assetNo),
          )
          ..orderBy([(t) => OrderingTerm.asc(t.position)]))
        .get();
  }

  /// Serial search and the barcode scanner.
  ///
  /// Matches case-insensitively through the normalised column to HELP the
  /// technician find the row. The caller must send the row's own [serialNo]
  /// verbatim in any command: the server's serial column is case-split, and
  /// uppercasing it there turns a split-history problem into a
  /// cannot-find-the-tyre problem in the field.
  Future<List<CachedTyre>> tyresBySerial({
    required WorkspaceScopeFilter scope,
    required String serial,
    int limit = 20,
  }) {
    final String normalised = normaliseLookupKey(serial);
    if (normalised.isEmpty) {
      return Future<List<CachedTyre>>.value(const <CachedTyre>[]);
    }
    return (select(cachedTyres)
          ..where(
            (t) =>
                scopeWhere(scope, t.workspaceId, t.country) &
                t.serialNoNorm.equals(normalised),
          )
          ..orderBy([(t) => OrderingTerm.desc(t.issueDate)])
          ..limit(limit))
        .get();
  }

  /// Marks a tyre as recently looked at, which is what keeps it out of the
  /// pruner's reach.
  Future<void> touchTyre(String id, DateTime now) async {
    await (update(cachedTyres)..where((t) => t.id.equals(id))).write(
      CachedTyresCompanion(lastSeenAt: Value<DateTime>(now)),
    );
  }

  /// Trims to the newest [RetentionLimits.cachedTyres] by `lastSeenAt`.
  ///
  /// Uses a cutoff timestamp rather than a list of ids: two thousand bound
  /// variables would exceed SQLite's parameter limit, and a tie at the boundary
  /// surviving is the safe direction to be wrong in.
  Future<int> pruneTyresToCap({int cap = RetentionLimits.cachedTyres}) async {
    final boundary =
        await (select(cachedTyres)
              ..orderBy([
                (t) => OrderingTerm.desc(t.lastSeenAt),
                (t) => OrderingTerm.desc(t.id),
              ])
              ..limit(1, offset: cap - 1))
            .getSingleOrNull();
    if (boundary == null) {
      return 0;
    }
    return (delete(
      cachedTyres,
    )..where((t) => t.lastSeenAt.isSmallerThanValue(boundary.lastSeenAt))).go();
  }

  // -- Permissions ----------------------------------------------------------

  /// Replaces one user's cached grants for one workspace.
  ///
  /// An empty result is stored as an empty table for that user, which the
  /// resolver must read as "no explicit grants", never as "deny everything". A
  /// cache miss renders the role default; RLS remains the real boundary either
  /// way, and this decides only which screens are offered.
  Future<void> replacePermissions({
    required String userId,
    required String workspaceId,
    required List<CachedPermissionsCompanion> rows,
    required DateTime now,
  }) async {
    await transaction(() async {
      await (delete(cachedPermissions)..where(
            (t) => t.userId.equals(userId) & t.workspaceId.equals(workspaceId),
          ))
          .go();
      await batch((Batch b) => b.insertAll(cachedPermissions, rows));
      await into(syncMetadata).insertOnConflictUpdate(
        SyncMetadataCompanion.insert(
          key: SyncMetadataKeys.cacheLastFullSyncAt('cached_permissions'),
          valueJson: now.toIso8601String(),
          updatedAt: now,
          workspaceId: Value<String?>(workspaceId),
        ),
      );
    });
  }

  /// The grants that apply right now. An expired grant is not returned at all,
  /// so no caller has to remember to check the date.
  Future<List<CachedPermission>> permissionsFor({
    required String userId,
    required String workspaceId,
    required DateTime now,
  }) {
    return (select(cachedPermissions)..where(
          (t) =>
              t.userId.equals(userId) &
              t.workspaceId.equals(workspaceId) &
              (t.expiresAt.isNull() | t.expiresAt.isBiggerThanValue(now)),
        ))
        .get();
  }

  // -- Recent searches ------------------------------------------------------

  /// Records a search, deduplicated on the normalised term.
  ///
  /// Searching the same thing twice updates the timestamp; it does not add a
  /// second row. The row records a TERM and an id, never a permission: a
  /// recents list that replayed an allow could hand back access after a grant
  /// was withdrawn.
  Future<void> recordSearch({
    required String userId,
    required String workspaceId,
    required String term,
    required DateTime now,
    String? resultKind,
    String? resultId,
  }) async {
    final String normalised = normaliseLookupKey(term);
    if (normalised.isEmpty) {
      return;
    }

    await transaction(() async {
      final existing =
          await (select(recentSearches)
                ..where(
                  (t) =>
                      t.userId.equals(userId) &
                      t.workspaceId.equals(workspaceId) &
                      t.termNorm.equals(normalised),
                )
                ..limit(1))
              .getSingleOrNull();

      if (existing == null) {
        await into(recentSearches).insert(
          RecentSearchesCompanion.insert(
            id: _uuid.v4(),
            userId: userId,
            workspaceId: workspaceId,
            term: term,
            termNorm: normalised,
            searchedAt: now,
            resultKind: Value<String?>(resultKind),
            resultId: Value<String?>(resultId),
          ),
        );
      } else {
        await (update(
          recentSearches,
        )..where((t) => t.id.equals(existing.id))).write(
          RecentSearchesCompanion(
            term: Value<String>(term),
            searchedAt: Value<DateTime>(now),
            resultKind: Value<String?>(resultKind),
            resultId: Value<String?>(resultId),
          ),
        );
      }

      await _pruneRecentSearches(userId: userId, workspaceId: workspaceId);
    });
  }

  Future<List<RecentSearch>> recentSearchesFor({
    required String userId,
    required String workspaceId,
    int limit = RetentionLimits.recentSearches,
  }) {
    if (userId.isEmpty) {
      return Future<List<RecentSearch>>.value(const <RecentSearch>[]);
    }
    return (select(recentSearches)
          ..where(
            (t) => t.userId.equals(userId) & t.workspaceId.equals(workspaceId),
          )
          ..orderBy([(t) => OrderingTerm.desc(t.searchedAt)])
          ..limit(limit))
        .get();
  }

  /// Cleared on sign-out. A shared handset must not show the next technician
  /// what the previous one looked up.
  Future<int> clearSearchesForUser(String userId) {
    return (delete(recentSearches)..where((t) => t.userId.equals(userId))).go();
  }

  // -- Cache bookkeeping ----------------------------------------------------

  Future<SyncMetadataEntry?> readMetadata(String key) {
    return (select(syncMetadata)
          ..where((t) => t.key.equals(key))
          ..limit(1))
        .getSingleOrNull();
  }

  Future<void> writeMetadata({
    required String key,
    required String valueJson,
    required DateTime now,
    String? workspaceId,
  }) async {
    await into(syncMetadata).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(
        key: key,
        valueJson: valueJson,
        updatedAt: now,
        workspaceId: Value<String?>(workspaceId),
      ),
    );
  }

  /// True when the last fill of [table] hit its page ceiling, so the UI can say
  /// the list is short instead of implying the fleet is.
  Future<bool> cacheIsTruncated(String table) async {
    final SyncMetadataEntry? row = await readMetadata(
      SyncMetadataKeys.cacheTruncated(table),
    );
    return row?.valueJson == 'true';
  }

  Future<DateTime?> cacheLastSyncedAt(String table) async {
    final SyncMetadataEntry? row = await readMetadata(
      SyncMetadataKeys.cacheLastFullSyncAt(table),
    );
    final String? value = row?.valueJson;
    if (value == null) {
      return null;
    }
    return DateTime.tryParse(value);
  }

  Future<void> _recordCacheSync({
    required String table,
    required WorkspaceScopeFilter scope,
    required int rowCount,
    required bool truncated,
    required DateTime now,
  }) async {
    await into(syncMetadata).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(
        key: SyncMetadataKeys.cacheLastFullSyncAt(table),
        valueJson: now.toIso8601String(),
        updatedAt: now,
        workspaceId: Value<String?>(scope.workspaceId),
      ),
    );
    await into(syncMetadata).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(
        key: SyncMetadataKeys.cacheRowCount(table),
        valueJson: '$rowCount',
        updatedAt: now,
        workspaceId: Value<String?>(scope.workspaceId),
      ),
    );
    await into(syncMetadata).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(
        key: SyncMetadataKeys.cacheTruncated(table),
        valueJson: truncated ? 'true' : 'false',
        updatedAt: now,
        workspaceId: Value<String?>(scope.workspaceId),
      ),
    );
  }

  Future<void> _pruneRecentSearches({
    required String userId,
    required String workspaceId,
  }) async {
    final keep =
        await (select(recentSearches)
              ..where(
                (t) =>
                    t.userId.equals(userId) & t.workspaceId.equals(workspaceId),
              )
              ..orderBy([
                (t) => OrderingTerm.desc(t.searchedAt),
                (t) => OrderingTerm.desc(t.id),
              ])
              ..limit(RetentionLimits.recentSearches))
            .get();
    if (keep.isEmpty) {
      return;
    }
    final List<String> keepIds = keep
        .map((RecentSearch r) => r.id)
        .toList(growable: false);
    await (delete(recentSearches)..where(
          (t) =>
              t.userId.equals(userId) &
              t.workspaceId.equals(workspaceId) &
              t.id.isIn(keepIds).not(),
        ))
        .go();
  }

  /// Refuses rows stamped for a workspace other than the one being filled.
  ///
  /// The read side filters, but a cache poisoned on the way in cannot be
  /// filtered clean on the way out: the rows would simply never appear for
  /// their real tenant and would appear for the wrong one only if the filter
  /// were also wrong. Refusing at the boundary makes the mistake loud instead.
  void _requireScopedRows(
    Iterable<Value<String>> workspaceValues,
    WorkspaceScopeFilter scope,
    String table,
  ) {
    for (final Value<String> value in workspaceValues) {
      if (!value.present || value.value != scope.workspaceId) {
        throw AppError(
          kind: AppErrorKind.validation,
          message:
              'This data could not be saved for offline use. Sign out and '
              'in again, then try once more.',
          technical:
              'refused a $table row for a workspace other than '
              '${scope.workspaceId}',
        );
      }
    }
  }
}
