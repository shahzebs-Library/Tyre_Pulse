// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cache_dao.dart';

// ignore_for_file: type=lint
mixin _$CacheDaoMixin on DatabaseAccessor<AppDatabase> {
  $WorkspaceScopesTable get workspaceScopes => attachedDatabase.workspaceScopes;
  $CachedUsersTable get cachedUsers => attachedDatabase.cachedUsers;
  $CachedSitesTable get cachedSites => attachedDatabase.cachedSites;
  $CachedAssetsTable get cachedAssets => attachedDatabase.cachedAssets;
  $CachedTyresTable get cachedTyres => attachedDatabase.cachedTyres;
  $CachedChecklistTemplatesTable get cachedChecklistTemplates =>
      attachedDatabase.cachedChecklistTemplates;
  $CachedPermissionsTable get cachedPermissions =>
      attachedDatabase.cachedPermissions;
  $RecentSearchesTable get recentSearches => attachedDatabase.recentSearches;
  $SyncMetadataTable get syncMetadata => attachedDatabase.syncMetadata;
  CacheDaoManager get managers => CacheDaoManager(this);
}

class CacheDaoManager {
  final _$CacheDaoMixin _db;
  CacheDaoManager(this._db);
  $$WorkspaceScopesTableTableManager get workspaceScopes =>
      $$WorkspaceScopesTableTableManager(
          _db.attachedDatabase, _db.workspaceScopes);
  $$CachedUsersTableTableManager get cachedUsers =>
      $$CachedUsersTableTableManager(_db.attachedDatabase, _db.cachedUsers);
  $$CachedSitesTableTableManager get cachedSites =>
      $$CachedSitesTableTableManager(_db.attachedDatabase, _db.cachedSites);
  $$CachedAssetsTableTableManager get cachedAssets =>
      $$CachedAssetsTableTableManager(_db.attachedDatabase, _db.cachedAssets);
  $$CachedTyresTableTableManager get cachedTyres =>
      $$CachedTyresTableTableManager(_db.attachedDatabase, _db.cachedTyres);
  $$CachedChecklistTemplatesTableTableManager get cachedChecklistTemplates =>
      $$CachedChecklistTemplatesTableTableManager(
          _db.attachedDatabase, _db.cachedChecklistTemplates);
  $$CachedPermissionsTableTableManager get cachedPermissions =>
      $$CachedPermissionsTableTableManager(
          _db.attachedDatabase, _db.cachedPermissions);
  $$RecentSearchesTableTableManager get recentSearches =>
      $$RecentSearchesTableTableManager(
          _db.attachedDatabase, _db.recentSearches);
  $$SyncMetadataTableTableManager get syncMetadata =>
      $$SyncMetadataTableTableManager(_db.attachedDatabase, _db.syncMetadata);
}
