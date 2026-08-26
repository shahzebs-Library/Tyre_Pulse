/// The in-progress checklist: reads and writes over `DraftsDao` and
/// `MediaDao`, translated into and out of this feature's own domain types.
///
/// # Ownership boundary
///
/// This file CONSUMES `DraftsDao` and `MediaDao` (`lib/core/database/dao/
/// *.dart`) exactly as they are - it adds no migration, no table and no
/// column. `OwnerKind.checklistDraft` and `primarySignatureFieldKey` are
/// read, never redefined, from `database_constants.dart`.
///
/// # One draft, MANY signature slots
///
/// This is the one place this feature's draft handling genuinely diverges
/// from `features/inspections/data/inspection_draft_repository.dart`'s own
/// pattern (read there, never imported from here): an inspection has exactly
/// ONE signing slot ([primarySignatureFieldKey] fixed); a checklist sheet
/// can be signed by several trades as several separate `signature`-type
/// fields, so [signatures] is a MAP keyed by field id, and
/// [primarySignatureFieldKey] is reserved for an OPTIONAL template-level pad
/// on top of those - see `checklist_signature_gate.dart`. The unique index
/// on (ownerKind, ownerKey, fieldKey) in `captured_signatures` is exactly
/// what makes a real per-field slot possible instead of the historical
/// shared-slot defect ("three trades signing one sheet overwrote each
/// other, only the last reached the database").
///
/// # The draft is NOT discarded at submit time by THIS file
///
/// [discardDraft] exists here as a primitive, but the decision of WHEN to
/// call it belongs to `checklist_submission_repository.dart` - and there,
/// deliberately, ownership of any attached photo FILES has already been
/// handed to the offline queue by the time it is called, so this method's
/// returned paths must not be deleted by that caller. See that file's own
/// library comment.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';

/// One draft photo, decoded for the presentation layer.
class ChecklistDraftPhoto {
  const ChecklistDraftPhoto({
    required this.id,
    required this.fieldKey,
    required this.localPath,
    required this.capturedAt,
  });

  final String id;
  final String fieldKey;
  final String localPath;
  final DateTime capturedAt;
}

/// One captured signature, decoded for the presentation layer.
class ChecklistDraftSignature {
  const ChecklistDraftSignature({
    required this.fieldKey,
    required this.payload,
    required this.format,
    required this.source,
    this.strokesJson,
  });

  final String fieldKey;
  final String payload;
  final String format;
  final String source;
  final String? strokesJson;
}

/// The header fields of an in-progress checklist, decoded for the
/// presentation layer.
class ChecklistDraftHeader {
  const ChecklistDraftHeader({
    required this.draftKey,
    required this.templateId,
    required this.templateName,
    required this.templateVersion,
    required this.assetNo,
    required this.filled,
    required this.total,
    required this.updatedAt,
    this.assignmentId,
    this.site,
    this.title,
    this.readLang,
    this.printedName,
  });

  final String draftKey;
  final String templateId;
  final String templateName;
  final int templateVersion;
  final String assetNo;
  final int filled;
  final int total;
  final DateTime updatedAt;
  final String? assignmentId;
  final String? site;
  final String? title;
  final String? readLang;
  final String? printedName;
}

/// The narrow surface the fill screen needs. Abstract so a controller test
/// can substitute an in-memory fake without a real Drift database.
abstract interface class ChecklistDraftRepository {
  /// The device-local key for a draft of [templateId] against [assetNo], for
  /// [userId]. Built ONLY here - a screen must never invent its own variant.
  String draftKeyFor({
    required String userId,
    required String templateId,
    required String assetNo,
  });

  /// Creates the draft if it does not exist, or updates it if it does.
  /// `createdAt` is never reset on an update - see
  /// `DraftsDao.saveChecklistDraft`'s own doc comment.
  Future<void> saveHeader({
    required String userId,
    required String workspaceId,
    required String templateId,
    required String templateName,
    required int templateVersion,
    required String assetNo,
    required Map<String, Object?> answers,
    required Map<String, Object?> notes,
    required int filled,
    required int total,
    String? assignmentId,
    String? site,
    String? title,
    String? readLang,
    String? printedName,
  });

  Future<ChecklistDraftHeader?> header(String draftKey);

  /// The decoded `answers` map for [draftKey], or `{}` when there is no
  /// draft, or its stored JSON cannot be decoded.
  Future<Map<String, Object?>> answers(String draftKey);

  /// The decoded `notes` map for [draftKey].
  Future<Map<String, Object?>> notes(String draftKey);

  /// Sheets that could be resumed for [templateId]. Narrows to one machine
  /// once [assetNo] is known; offers every sheet for the template while it
  /// is blank.
  Future<List<ChecklistDraftHeader>> resumeCandidates({
    required String userId,
    required String templateId,
    String? assetNo,
  });

  /// The unfinished-work list for [userId], newest first.
  Future<List<ChecklistDraftHeader>> draftsForUser(String userId);

  /// Attaches an already-resized, already-durable photo file to [fieldKey]
  /// on [draftKey].
  Future<void> addPhoto({
    required String draftKey,
    required String fieldKey,
    required String localPath,
    required DateTime capturedAt,
    int? sizeBytes,
    String? mimeType,
  });

  /// Every photo currently attached to [draftKey], across every field.
  Future<List<ChecklistDraftPhoto>> photosFor(String draftKey);

  /// Every signature currently on [draftKey], keyed by field id (or
  /// [primarySignatureFieldKey] for the template-level pad).
  Future<List<ChecklistDraftSignature>> signaturesFor(String draftKey);

  /// Saves the signature for [fieldKey] on [draftKey]. Pass
  /// [primarySignatureFieldKey] for the template-level pad.
  Future<void> saveSignature({
    required String draftKey,
    required String fieldKey,
    required String payload,
    required String source,
    String? strokesJson,
    String? signerUserId,
    String? signerName,
    String? signerRole,
  });

  /// Whether [draftKey] holds real work - progress, a photo or a signature -
  /// as opposed to a sheet that was merely opened.
  Future<bool> hasContent(String draftKey);

  /// Trims this user's drafts to the retention cap, oldest first. Returns
  /// the local photo paths of any discarded draft, for the caller to delete.
  Future<List<String>> pruneToCap(String userId);

  /// Discards the draft header, its photos and its signatures. Returns the
  /// local photo file paths whose rows were removed - see the library
  /// comment on when the CALLER may or may not delete them.
  Future<List<String>> discardDraft(String draftKey);
}

final class DriftChecklistDraftRepository implements ChecklistDraftRepository {
  DriftChecklistDraftRepository(this._draftsDao, this._mediaDao);

  final DraftsDao _draftsDao;
  final MediaDao _mediaDao;

  static const String _ownerKind = OwnerKind.checklistDraft;

  @override
  String draftKeyFor({
    required String userId,
    required String templateId,
    required String assetNo,
  }) =>
      DraftsDao.checklistDraftKey(
        userId: userId,
        templateId: templateId,
        assetNo: assetNo,
      );

  @override
  Future<void> saveHeader({
    required String userId,
    required String workspaceId,
    required String templateId,
    required String templateName,
    required int templateVersion,
    required String assetNo,
    required Map<String, Object?> answers,
    required Map<String, Object?> notes,
    required int filled,
    required int total,
    String? assignmentId,
    String? site,
    String? title,
    String? readLang,
    String? printedName,
  }) {
    return _draftsDao.saveChecklistDraft(
      userId: userId,
      workspaceId: workspaceId,
      templateId: templateId,
      templateName: templateName,
      templateVersion: templateVersion,
      assetNo: assetNo,
      answersJson: _encodeJson(answers),
      notesJson: _encodeJson(notes),
      filled: filled,
      total: total,
      now: DateTime.now().toUtc(),
      assignmentId: assignmentId,
      site: site,
      title: title,
      readLang: readLang,
      printedName: printedName,
    );
  }

  @override
  Future<ChecklistDraftHeader?> header(String draftKey) async {
    final row = await _draftsDao.checklistDraft(draftKey);
    if (row == null) return null;
    return _toHeader(row);
  }

  @override
  Future<Map<String, Object?>> answers(String draftKey) async {
    final row = await _draftsDao.checklistDraft(draftKey);
    return _decodeJson(row?.answersJson);
  }

  @override
  Future<Map<String, Object?>> notes(String draftKey) async {
    final row = await _draftsDao.checklistDraft(draftKey);
    return _decodeJson(row?.notesJson);
  }

  @override
  Future<List<ChecklistDraftHeader>> resumeCandidates({
    required String userId,
    required String templateId,
    String? assetNo,
  }) async {
    final rows = await _draftsDao.resumeCandidates(
      userId: userId,
      templateId: templateId,
      assetNo: assetNo,
    );
    return <ChecklistDraftHeader>[for (final row in rows) _toHeader(row)];
  }

  @override
  Future<List<ChecklistDraftHeader>> draftsForUser(String userId) async {
    final rows = await _draftsDao.checklistDraftsForUser(userId);
    return <ChecklistDraftHeader>[for (final row in rows) _toHeader(row)];
  }

  @override
  Future<void> addPhoto({
    required String draftKey,
    required String fieldKey,
    required String localPath,
    required DateTime capturedAt,
    int? sizeBytes,
    String? mimeType,
  }) async {
    await _mediaDao.addDraftPhoto(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
      localPath: localPath,
      fileName: _basename(localPath),
      capturedAt: capturedAt,
      fieldKey: fieldKey,
      sizeBytes: sizeBytes,
      mimeType: mimeType,
    );
  }

  @override
  Future<List<ChecklistDraftPhoto>> photosFor(String draftKey) async {
    final rows = await _mediaDao.draftPhotosFor(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
    );
    return <ChecklistDraftPhoto>[
      for (final row in rows)
        ChecklistDraftPhoto(
          id: row.id,
          fieldKey: row.fieldKey ?? '',
          localPath: row.localPath,
          capturedAt: row.capturedAt,
        ),
    ];
  }

  @override
  Future<List<ChecklistDraftSignature>> signaturesFor(String draftKey) async {
    final rows = await _mediaDao.signaturesFor(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
    );
    return <ChecklistDraftSignature>[
      for (final row in rows)
        ChecklistDraftSignature(
          fieldKey: row.fieldKey,
          payload: row.payload,
          format: row.format,
          source: row.source,
          strokesJson: row.strokesJson,
        ),
    ];
  }

  @override
  Future<void> saveSignature({
    required String draftKey,
    required String fieldKey,
    required String payload,
    required String source,
    String? strokesJson,
    String? signerUserId,
    String? signerName,
    String? signerRole,
  }) async {
    await _mediaDao.saveSignature(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
      fieldKey: fieldKey,
      payload: payload,
      source: source,
      signedAt: DateTime.now().toUtc(),
      strokesJson: strokesJson,
      signerUserId: signerUserId,
      signerName: signerName,
      signerRole: signerRole,
    );
  }

  @override
  Future<bool> hasContent(String draftKey) async {
    final header = await _draftsDao.checklistDraft(draftKey);
    return _draftsDao.draftHasContent(
      ownerKind: _ownerKind,
      ownerKey: draftKey,
      filled: header?.filled ?? 0,
    );
  }

  @override
  Future<List<String>> pruneToCap(String userId) {
    // `DraftsDao.pruneDraftsToCap` prunes BOTH draft tables at once; a
    // checklist-only repository cannot call the checklist half in
    // isolation without either duplicating its cap logic (drift risk) or
    // widening this feature's dependency onto the inspection table it has
    // no business knowing about. It is called with the checklist cap only
    // used implicitly - `inspectionCap` keeps its own default, which is
    // harmless here because this repository never touches
    // `inspection_drafts` itself.
    return _draftsDao.pruneDraftsToCap(userId: userId);
  }

  @override
  Future<List<String>> discardDraft(String draftKey) {
    return _draftsDao.discardChecklistDraft(draftKey);
  }

  ChecklistDraftHeader _toHeader(ChecklistDraft row) => ChecklistDraftHeader(
        draftKey: row.draftKey,
        templateId: row.templateId,
        templateName: row.templateName,
        templateVersion: row.templateVersion,
        assetNo: row.assetNo,
        filled: row.filled,
        total: row.total,
        updatedAt: row.updatedAt,
        assignmentId: row.assignmentId,
        site: row.site,
        title: row.title,
        readLang: row.readLang,
        printedName: row.printedName,
      );

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }
}

// -- Small JSON helpers -------------------------------------------------
//
// Plain `dart:convert` `jsonEncode`/`jsonDecode` (unlike
// `checklist_marks.dart`'s own minimal encoder, which exists ONLY to match
// Postgres's exact no-whitespace jsonb text form byte-for-byte for a
// SPECIFIC comparison). There is no such byte-matching requirement for a
// device-local draft column, so the standard library encoder is the right,
// simplest tool here.

String _encodeJson(Map<String, Object?> value) => jsonEncode(value);

Map<String, Object?> _decodeJson(String? raw) {
  if (raw == null || raw.isEmpty) return <String, Object?>{};
  try {
    final Object? decoded = jsonDecode(raw);
    if (decoded is Map) {
      return decoded.map(
        (Object? key, Object? value) =>
            MapEntry<String, Object?>(key.toString(), value),
      );
    }
    return <String, Object?>{};
  } on Object {
    // A corrupt row must not take the whole draft down with it - the rest
    // of the header (filled/total/updatedAt) is still real and useful.
    return <String, Object?>{};
  }
}
