// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'media_dao.dart';

// ignore_for_file: type=lint
mixin _$MediaDaoMixin on DatabaseAccessor<AppDatabase> {
  $PendingCommandsTable get pendingCommands => attachedDatabase.pendingCommands;
  $PendingMediaUploadsTable get pendingMediaUploads =>
      attachedDatabase.pendingMediaUploads;
  $DraftPhotosTable get draftPhotos => attachedDatabase.draftPhotos;
  $CapturedSignaturesTable get capturedSignatures =>
      attachedDatabase.capturedSignatures;
  MediaDaoManager get managers => MediaDaoManager(this);
}

class MediaDaoManager {
  final _$MediaDaoMixin _db;
  MediaDaoManager(this._db);
  $$PendingCommandsTableTableManager get pendingCommands =>
      $$PendingCommandsTableTableManager(
          _db.attachedDatabase, _db.pendingCommands);
  $$PendingMediaUploadsTableTableManager get pendingMediaUploads =>
      $$PendingMediaUploadsTableTableManager(
          _db.attachedDatabase, _db.pendingMediaUploads);
  $$DraftPhotosTableTableManager get draftPhotos =>
      $$DraftPhotosTableTableManager(_db.attachedDatabase, _db.draftPhotos);
  $$CapturedSignaturesTableTableManager get capturedSignatures =>
      $$CapturedSignaturesTableTableManager(
          _db.attachedDatabase, _db.capturedSignatures);
}
