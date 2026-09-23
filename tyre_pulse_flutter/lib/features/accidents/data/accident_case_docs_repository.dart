/// Case documents (`accident_evidence`) and case timeline notes
/// (`accident_case_communications`) for the M3 and M6 workspaces.
///
/// Uploads are ONLINE and go straight to the private `accident-photos`
/// bucket under the same `accidents/<owner>/<file>` namespace the queued
/// evidence uploader uses, so a document uploaded from a case screen resolves
/// through the same `tp-storage://` reference as a photo captured offline.
/// The evidence row is written only after Storage accepted the bytes; a
/// failed upload leaves no row that claims a document exists.
library;

import 'dart:io';

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_schema.dart';

typedef AccidentEvidenceRead = Future<List<Map<String, dynamic>>> Function(
  String accidentId,
);

typedef AccidentCaseInsert = Future<Map<String, dynamic>> Function(
  String table,
  Map<String, Object?> row,
);

/// Sends the bytes at [localPath] to [bucket]/[path].
typedef AccidentFileUpload = Future<void> Function(
  String bucket,
  String path,
  String localPath,
  String? contentType,
);

final Provider<AccidentCaseDocsRepository> accidentCaseDocsRepositoryProvider =
    Provider<AccidentCaseDocsRepository>((Ref ref) {
  final SupabaseClient client = ref.watch(supabaseClientProvider);
  return AccidentCaseDocsRepository(
    read: (String accidentId) => client
        .from(AccidentCaseTables.evidence)
        .select(AccidentCaseDocsRepository.columns)
        .eq('accident_id', accidentId),
    insert: (String table, Map<String, Object?> row) =>
        client.from(table).insert(row).select().single(),
    upload: (String bucket, String path, String localPath, String? type) =>
        client.storage.from(bucket).upload(
              path,
              File(localPath),
              fileOptions: FileOptions(upsert: false, contentType: type),
            ),
    currentUserId: () => client.auth.currentUser?.id,
  );
});

@immutable
final class AccidentEvidenceDoc {
  const AccidentEvidenceDoc({
    required this.id,
    this.workstreamKey,
    this.requirementKey,
    this.kind,
    this.storageRef,
    this.fileName,
    this.verificationStatus,
    this.uploadedBy,
    this.uploadedAt,
  });

  factory AccidentEvidenceDoc.fromRow(Map<String, dynamic> row) =>
      AccidentEvidenceDoc(
        id: accidentRowText(row['id']) ?? '',
        workstreamKey: accidentRowText(row['workstream_key']),
        requirementKey: accidentRowText(row['requirement_key']),
        kind: accidentRowText(row['kind']),
        storageRef: accidentRowText(row['storage_ref']),
        fileName: accidentRowText(row['file_name']),
        verificationStatus:
            accidentRowText(row['verification_status'])?.toLowerCase(),
        uploadedBy: accidentRowText(row['uploaded_by']),
        uploadedAt: accidentRowDate(row['uploaded_at']) ??
            accidentRowDate(row['created_at']),
      );

  final String id;
  final String? workstreamKey;
  final String? requirementKey;
  final String? kind;
  final String? storageRef;
  final String? fileName;

  /// `unverified | verified | rejected`.
  final String? verificationStatus;
  final String? uploadedBy;
  final DateTime? uploadedAt;
}

@immutable
final class AccidentEvidenceLoad {
  const AccidentEvidenceLoad({
    required this.provisioned,
    this.docs = const <AccidentEvidenceDoc>[],
  });

  final bool provisioned;
  final List<AccidentEvidenceDoc> docs;

  /// The newest document stored against [requirementKey], if any.
  AccidentEvidenceDoc? forRequirement(String requirementKey) {
    AccidentEvidenceDoc? best;
    for (final AccidentEvidenceDoc doc in docs) {
      if (doc.requirementKey != requirementKey) continue;
      if (best == null ||
          (doc.uploadedAt != null &&
              (best.uploadedAt == null ||
                  doc.uploadedAt!.isAfter(best.uploadedAt!)))) {
        best = doc;
      }
    }
    return best;
  }

  bool has(String requirementKey) => forRequirement(requirementKey) != null;
}

class AccidentCaseDocsRepository with SupabaseGateway {
  AccidentCaseDocsRepository({
    required AccidentEvidenceRead read,
    required AccidentCaseInsert insert,
    required AccidentFileUpload upload,
    required String? Function() currentUserId,
  })  : _read = read,
        _insert = insert,
        _upload = upload,
        _currentUserId = currentUserId;

  final AccidentEvidenceRead _read;
  final AccidentCaseInsert _insert;
  final AccidentFileUpload _upload;
  final String? Function() _currentUserId;

  static const String columns = 'id,accident_id,workstream_key,'
      'requirement_key,kind,storage_ref,file_name,verification_status,'
      'uploaded_by,uploaded_at,created_at';

  static const Set<String> kinds = <String>{'photo', 'video', 'document'};

  Future<AccidentEvidenceLoad> listEvidence(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    try {
      final List<Map<String, dynamic>> rows = await guard(() => _read(id));
      return AccidentEvidenceLoad(
        provisioned: true,
        docs: <AccidentEvidenceDoc>[
          for (final Map<String, dynamic> row in rows)
            AccidentEvidenceDoc.fromRow(row),
        ],
      );
    } on SupabaseFailure catch (failure) {
      if (isMissingSchema(failure)) {
        return const AccidentEvidenceLoad(provisioned: false);
      }
      rethrow;
    }
  }

  /// Uploads the file at [localPath] and records it against
  /// [requirementKey]. The stored reference is `tp-storage://` opaque, never
  /// a public URL.
  Future<AccidentEvidenceDoc> upload({
    required String accidentId,
    required String workstreamKey,
    required String requirementKey,
    required String localPath,
    String kind = 'document',
    String? country,
    String? site,
  }) async {
    final String id = accidentId.trim();
    final String path = localPath.trim();
    if (id.isEmpty ||
        workstreamKey.trim().isEmpty ||
        requirementKey.trim().isEmpty ||
        path.isEmpty ||
        !kinds.contains(kind)) {
      throw ArgumentError('Invalid accident document upload');
    }
    return guard(() async {
      final String? owner = _currentUserId();
      if (owner == null || owner.trim().isEmpty) {
        throw const AppError.authentication();
      }
      final String fileName = _basename(path);
      final String objectPath = accidentEvidenceObjectPath(
        userId: owner,
        fileName: fileName,
      );
      await _upload(
        accidentEvidenceBucket,
        objectPath,
        path,
        accidentEvidenceContentType(fileName),
      );
      final Map<String, dynamic> saved = await _insert(
        AccidentCaseTables.evidence,
        <String, Object?>{
          'accident_id': id,
          'workstream_key': workstreamKey.trim(),
          'requirement_key': requirementKey.trim(),
          'kind': kind,
          'storage_ref': 'tp-storage://$accidentEvidenceBucket/$objectPath',
          'file_name': fileName,
          'mime_type': accidentEvidenceContentType(fileName),
          'verification_status': 'unverified',
          'uploaded_by': owner,
          'uploaded_at': DateTime.now().toUtc().toIso8601String(),
          if (country != null && country.trim().isNotEmpty)
            'country': country.trim(),
          if (site != null && site.trim().isNotEmpty) 'site': site.trim(),
        },
      );
      return AccidentEvidenceDoc.fromRow(saved);
    });
  }

  /// Writes one internal in-app note on the case timeline. Nothing is
  /// emailed or pushed by this call; server-side notification triggers decide
  /// that.
  Future<void> logCommunication({
    required String accidentId,
    required String workstreamKey,
    required String subject,
    required String body,
    String? toParty,
    String? authorName,
    String? country,
    String? site,
  }) async {
    final String id = accidentId.trim();
    if (id.isEmpty || subject.trim().isEmpty) {
      throw ArgumentError('A case and a subject are required');
    }
    await guard(() async {
      await _insert(
        AccidentCaseTables.communications,
        <String, Object?>{
          'accident_id': id,
          'channel': 'in_app',
          'direction': 'internal',
          'subject': subject.trim(),
          'body': body.trim().isEmpty ? null : body.trim(),
          'to_party': toParty?.trim().isEmpty ?? true ? null : toParty!.trim(),
          'workstream_key': workstreamKey.trim(),
          'occurred_at': DateTime.now().toUtc().toIso8601String(),
          'author_id': _currentUserId(),
          'author_name':
              authorName?.trim().isEmpty ?? true ? null : authorName!.trim(),
          if (country != null && country.trim().isNotEmpty)
            'country': country.trim(),
          if (site != null && site.trim().isNotEmpty) 'site': site.trim(),
        },
      );
    });
  }
}

/// Mirrors the production `accidents/<owner>/<file>` namespace used by the
/// queued evidence uploader so both paths land in one place.
String accidentEvidenceObjectPath({
  required String userId,
  required String fileName,
}) {
  final String name = fileName.trim();
  if (name.isEmpty ||
      name == '.' ||
      name == '..' ||
      name.contains('/') ||
      name.contains(r'\')) {
    throw ArgumentError.value(fileName, 'fileName', 'must be one basename');
  }
  final String owner = userId.trim();
  final String ownerSegment = owner.length <= 8 ? owner : owner.substring(0, 8);
  return 'accidents/$ownerSegment/$name';
}

String? accidentEvidenceContentType(String fileName) {
  final String lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return null;
}

String _basename(String path) {
  final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
  return slash < 0 ? path : path.substring(slash + 1);
}
