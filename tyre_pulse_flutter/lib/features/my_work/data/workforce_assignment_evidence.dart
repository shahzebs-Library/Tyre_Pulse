/// Evidence (photo or PDF) attached to a company work assignment.
///
/// Backed by `public.workforce_assignment_evidence` and the private storage
/// bucket `workforce-evidence`, both from
/// `supabase/migrations/20261109160000_workforce_operations_core.sql`
/// (bucket created by `20261022104000_workforce_evidence.sql`). The server
/// rules this file mirrors, so a refusal is explained before it is sent:
///
/// - only the assignee uploads, and only while the assignment is
///   `acknowledged`, `in_progress` or `blocked` (insert policy + storage
///   policy);
/// - the object path is `<organisation_id>/assignments/<assignment_id>/<file>`;
/// - `mime_type` is `image/jpeg`, `image/png` or `application/pdf`;
/// - `byte_size` is 1 byte to 10 MB; `file_name` is 1-240 characters;
/// - rows are append-only (no update, no delete).
///
/// ONLINE-ONLY by decision. A photo is the largest thing the app sends and the
/// generic command registry (`core/sync/command_registry.dart`) is a closed
/// enum this feature may not edit; queuing evidence would need a durable
/// photo store with upload confirmation, which is a separate piece of work.
/// The screen states plainly that evidence needs a connection, and it never
/// claims an upload succeeded until both the file and its row are stored.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';

/// Private bucket for workforce evidence.
const String workforceEvidenceBucket = 'workforce-evidence';

/// Table holding one row per uploaded assignment evidence file.
const String workforceAssignmentEvidenceTable = 'workforce_assignment_evidence';

/// Server limit (`byte_size` CHECK and the bucket's `file_size_limit`).
const int workforceEvidenceMaxBytes = 10485760;

/// Assignment statuses in which the assignee may attach evidence.
const Set<String> workforceEvidenceStatuses = <String>{
  'acknowledged',
  'in_progress',
  'blocked',
};

/// `workforce_assignment_evidence.kind` values this app writes.
enum WorkforceEvidenceKind {
  photo('photo'),
  document('document');

  const WorkforceEvidenceKind(this.wire);
  final String wire;
}

/// A file chosen by the person, ready to validate and upload.
final class WorkforceEvidenceFile {
  const WorkforceEvidenceFile({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
    required this.kind,
  });

  final Uint8List bytes;
  final String fileName;
  final String mimeType;
  final WorkforceEvidenceKind kind;
}

/// Why a chosen file cannot be attached.
enum WorkforceEvidenceProblem {
  /// Empty, or over 10 MB.
  size,

  /// Not JPG, PNG or PDF.
  type,

  /// The assignment is not in a status that accepts evidence.
  status,

  /// The organisation could not be determined (an old cached row).
  unavailable,
}

/// Raised by [WorkforceEvidenceSource.upload] with a typed [problem]; a
/// transport or server failure is rethrown as is.
final class WorkforceEvidenceException implements Exception {
  const WorkforceEvidenceException(this.problem);
  final WorkforceEvidenceProblem problem;

  @override
  String toString() => 'WorkforceEvidenceException(${problem.name})';
}

/// The MIME type for a file name, or `null` when the server would refuse it.
String? workforceEvidenceMimeFor(String fileName) {
  final int dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  switch (fileName.substring(dot + 1).toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'pdf':
      return 'application/pdf';
    default:
      return null;
  }
}

String _extensionFor(String mimeType) => switch (mimeType) {
      'image/png' => 'png',
      'application/pdf' => 'pdf',
      _ => 'jpg',
    };

/// Checks [file] against the server rules; `null` means it may be sent.
WorkforceEvidenceProblem? validateWorkforceEvidence(
  WorkforceEvidenceFile file,
) {
  if (file.bytes.isEmpty || file.bytes.length > workforceEvidenceMaxBytes) {
    return WorkforceEvidenceProblem.size;
  }
  const Set<String> allowed = <String>{
    'image/jpeg',
    'image/png',
    'application/pdf',
  };
  if (!allowed.contains(file.mimeType)) return WorkforceEvidenceProblem.type;
  return null;
}

/// The storage object path the server's policies accept.
String workforceEvidencePath({
  required String organisationId,
  required String assignmentId,
  required int stamp,
  required String mimeType,
}) =>
    '$organisationId/assignments/$assignmentId/$stamp.${_extensionFor(mimeType)}';

/// A file name the `file_name` CHECK accepts (1-240 characters).
String workforceEvidenceFileName(String raw, String mimeType) {
  final String trimmed = raw.trim();
  final String name =
      trimmed.isEmpty ? 'evidence.${_extensionFor(mimeType)}' : trimmed;
  return name.length <= 240 ? name : name.substring(name.length - 240);
}

abstract interface class WorkforceEvidenceSource {
  /// Evidence rows per assignment id. `null` means "could not count" (offline,
  /// or a server without the table) and must never render as zero.
  Future<Map<String, int>?> counts(List<String> assignmentIds);

  /// Uploads [file] for [assignment]. Throws [WorkforceEvidenceException] for
  /// a rule the server would refuse, or the original error on failure.
  Future<void> upload(
    WorkforceAssignment assignment,
    WorkforceEvidenceFile file,
  );
}

final class SupabaseWorkforceEvidenceSource implements WorkforceEvidenceSource {
  SupabaseWorkforceEvidenceSource(this._client, {int Function()? stamp})
      : _stamp = stamp ?? (() => DateTime.now().toUtc().microsecondsSinceEpoch);

  final SupabaseClient _client;
  final int Function() _stamp;

  @override
  Future<Map<String, int>?> counts(List<String> assignmentIds) async {
    if (assignmentIds.isEmpty) return const <String, int>{};
    try {
      final List<dynamic> rows = await _client
          .from(workforceAssignmentEvidenceTable)
          .select('assignment_id')
          .inFilter('assignment_id', assignmentIds) as List<dynamic>;
      return countWorkforceEvidence(assignmentIds, rows);
    } on Object {
      return null;
    }
  }

  @override
  Future<void> upload(
    WorkforceAssignment assignment,
    WorkforceEvidenceFile file,
  ) async {
    if (!workforceEvidenceStatuses.contains(assignment.status)) {
      throw const WorkforceEvidenceException(WorkforceEvidenceProblem.status);
    }
    final WorkforceEvidenceProblem? problem = validateWorkforceEvidence(file);
    if (problem != null) throw WorkforceEvidenceException(problem);
    final String? org = assignment.organisationId;
    if (org == null) {
      throw const WorkforceEvidenceException(
        WorkforceEvidenceProblem.unavailable,
      );
    }
    final String path = workforceEvidencePath(
      organisationId: org,
      assignmentId: assignment.id,
      stamp: _stamp(),
      mimeType: file.mimeType,
    );
    await _client.storage.from(workforceEvidenceBucket).uploadBinary(
          path,
          file.bytes,
          fileOptions: FileOptions(contentType: file.mimeType),
        );
    try {
      await _client.from(workforceAssignmentEvidenceTable).insert(
            workforceEvidenceRow(
              organisationId: org,
              assignmentId: assignment.id,
              objectPath: path,
              file: file,
            ),
          );
    } on Object {
      // No storage delete policy exists for this bucket, so the attempt may
      // be refused; the unreferenced object stays unreadable (the select
      // policy needs a matching evidence row). The original error is what the
      // person is told about.
      try {
        await _client.storage.from(workforceEvidenceBucket).remove(<String>[
          path,
        ]);
      } on Object {
        // Best effort only.
      }
      rethrow;
    }
  }
}

/// The insert payload. `uploaded_by` is left to the column default
/// (`auth.uid()`), which the insert policy also checks.
Map<String, Object?> workforceEvidenceRow({
  required String organisationId,
  required String assignmentId,
  required String objectPath,
  required WorkforceEvidenceFile file,
}) =>
    <String, Object?>{
      'organisation_id': organisationId,
      'assignment_id': assignmentId,
      'kind': file.kind.wire,
      'object_path': objectPath,
      'file_name': workforceEvidenceFileName(file.fileName, file.mimeType),
      'mime_type': file.mimeType,
      'byte_size': file.bytes.length,
    };

/// Counts evidence rows per id; ids with no rows count 0.
Map<String, int> countWorkforceEvidence(
  List<String> assignmentIds,
  List<dynamic> rows,
) {
  final Map<String, int> counts = <String, int>{
    for (final String id in assignmentIds) id: 0,
  };
  for (final dynamic row in rows) {
    if (row is! Map) continue;
    final Object? id = row['assignment_id'];
    if (id is String && counts.containsKey(id)) counts[id] = counts[id]! + 1;
  }
  return counts;
}

/// Lets the screen pick evidence without a platform picker in tests.
abstract interface class WorkforceEvidencePicker {
  /// A compressed photo, or `null` when the person cancelled.
  Future<WorkforceEvidenceFile?> pickPhoto({required bool fromCamera});

  /// A PDF document, or `null` when the person cancelled.
  Future<WorkforceEvidenceFile?> pickPdf();
}

/// Same three-rung resize/quality ladder as every other photo capture in the
/// app (for example `features/workshop/data/workshop_photo_capture.dart`), so
/// a photo is compressed before it is ever uploaded.
const List<({int maxDimension, int quality})> _kResizeLadder =
    <({int maxDimension, int quality})>[
  (maxDimension: 1600, quality: 50),
  (maxDimension: 1024, quality: 45),
  (maxDimension: 720, quality: 40),
];

final class PlatformWorkforceEvidencePicker implements WorkforceEvidencePicker {
  PlatformWorkforceEvidencePicker({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<WorkforceEvidenceFile?> pickPhoto({required bool fromCamera}) async {
    XFile? picked;
    for (final ({int maxDimension, int quality}) rung in _kResizeLadder) {
      try {
        picked = await _picker.pickImage(
          source: fromCamera ? ImageSource.camera : ImageSource.gallery,
          maxWidth: rung.maxDimension.toDouble(),
          maxHeight: rung.maxDimension.toDouble(),
          imageQuality: rung.quality,
        );
        if (picked == null) return null;
        break;
      } on Object {
        continue;
      }
    }
    if (picked == null) return null;
    final Uint8List bytes = await File(picked.path).readAsBytes();
    // An unsupported format (HEIC, WEBP) is reported as such by validation,
    // never relabelled as JPEG.
    final String mime = workforceEvidenceMimeFor(picked.name) ?? 'unsupported';
    return WorkforceEvidenceFile(
      bytes: bytes,
      fileName: picked.name,
      mimeType: mime,
      kind: WorkforceEvidenceKind.photo,
    );
  }

  @override
  Future<WorkforceEvidenceFile?> pickPdf() async {
    final PlatformFile? file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: <String>['pdf'],
    );
    if (file == null) return null;
    final Uint8List bytes = await file.readAsBytes();
    return WorkforceEvidenceFile(
      bytes: bytes,
      fileName: file.name,
      mimeType: workforceEvidenceMimeFor(file.name) ?? 'unsupported',
      kind: WorkforceEvidenceKind.document,
    );
  }
}
