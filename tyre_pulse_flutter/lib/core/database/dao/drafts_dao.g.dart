// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'drafts_dao.dart';

// ignore_for_file: type=lint
mixin _$DraftsDaoMixin on DatabaseAccessor<AppDatabase> {
  $InspectionDraftsTable get inspectionDrafts =>
      attachedDatabase.inspectionDrafts;
  $InspectionDraftPositionsTable get inspectionDraftPositions =>
      attachedDatabase.inspectionDraftPositions;
  $ChecklistDraftsTable get checklistDrafts => attachedDatabase.checklistDrafts;
  $DraftPhotosTable get draftPhotos => attachedDatabase.draftPhotos;
  $CapturedSignaturesTable get capturedSignatures =>
      attachedDatabase.capturedSignatures;
  DraftsDaoManager get managers => DraftsDaoManager(this);
}

class DraftsDaoManager {
  final _$DraftsDaoMixin _db;
  DraftsDaoManager(this._db);
  $$InspectionDraftsTableTableManager get inspectionDrafts =>
      $$InspectionDraftsTableTableManager(
          _db.attachedDatabase, _db.inspectionDrafts);
  $$InspectionDraftPositionsTableTableManager get inspectionDraftPositions =>
      $$InspectionDraftPositionsTableTableManager(
          _db.attachedDatabase, _db.inspectionDraftPositions);
  $$ChecklistDraftsTableTableManager get checklistDrafts =>
      $$ChecklistDraftsTableTableManager(
          _db.attachedDatabase, _db.checklistDrafts);
  $$DraftPhotosTableTableManager get draftPhotos =>
      $$DraftPhotosTableTableManager(_db.attachedDatabase, _db.draftPhotos);
  $$CapturedSignaturesTableTableManager get capturedSignatures =>
      $$CapturedSignaturesTableTableManager(
          _db.attachedDatabase, _db.capturedSignatures);
}
