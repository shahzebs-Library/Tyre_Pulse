// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'queue_dao.dart';

// ignore_for_file: type=lint
mixin _$QueueDaoMixin on DatabaseAccessor<AppDatabase> {
  $PendingCommandsTable get pendingCommands => attachedDatabase.pendingCommands;
  $PendingMediaUploadsTable get pendingMediaUploads =>
      attachedDatabase.pendingMediaUploads;
  $SyncFailuresTable get syncFailures => attachedDatabase.syncFailures;
  $SyncMetadataTable get syncMetadata => attachedDatabase.syncMetadata;
  QueueDaoManager get managers => QueueDaoManager(this);
}

class QueueDaoManager {
  final _$QueueDaoMixin _db;
  QueueDaoManager(this._db);
  $$PendingCommandsTableTableManager get pendingCommands =>
      $$PendingCommandsTableTableManager(
          _db.attachedDatabase, _db.pendingCommands);
  $$PendingMediaUploadsTableTableManager get pendingMediaUploads =>
      $$PendingMediaUploadsTableTableManager(
          _db.attachedDatabase, _db.pendingMediaUploads);
  $$SyncFailuresTableTableManager get syncFailures =>
      $$SyncFailuresTableTableManager(_db.attachedDatabase, _db.syncFailures);
  $$SyncMetadataTableTableManager get syncMetadata =>
      $$SyncMetadataTableTableManager(_db.attachedDatabase, _db.syncMetadata);
}
