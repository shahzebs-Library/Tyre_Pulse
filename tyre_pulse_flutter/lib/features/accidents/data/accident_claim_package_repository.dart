/// Mock M4 "Register insurance claim": the claim document package, the
/// registered claim, recoveries, the liability decision and the document
/// request log. Registration itself goes through the verified
/// `accident_claim_register` RPC already wrapped by
/// [AccidentClaimRepository]; this file never re-implements it.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_rows.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';

/// Everything M4 reads, loaded in one call.
@immutable
final class AccidentClaimPackage {
  const AccidentClaimPackage({
    required this.claim,
    required this.evidence,
    required this.recoveries,
    required this.notes,
    this.liabilityType,
    this.ourLiabilityPct,
    this.repairRoute,
  });

  final AccidentClaim? claim;
  final List<AccidentEvidenceItem> evidence;
  final List<AccidentClaimRecovery> recoveries;

  /// Honest "not provisioned yet" notes for reads that hit a missing table
  /// or column instead of silently rendering as empty.
  final List<String> notes;
  final String? liabilityType;
  final num? ourLiabilityPct;

  /// `accident_repair_orders.repair_route`; 'external' raises the M4 banner.
  final String? repairRoute;
}

class AccidentClaimPackageRepository with SupabaseGateway {
  AccidentClaimPackageRepository(this._rows, this._claims);

  final AccidentCaseRows _rows;
  final AccidentClaimRepository _claims;

  Future<AccidentClaimPackage> load(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    final List<String> notes = <String>[];

    final AccidentClaim? claim = await _claims.latest(id);

    final List<Map<String, dynamic>> evidenceRows = await _read(
      notes,
      'The claim document package',
      () => _rows.select(
        SupabaseTables.accidentEvidence,
        <String, Object>{'accident_id': id, 'workstream_key': 'insurance'},
        orderBy: 'uploaded_at',
      ),
    );

    final List<Map<String, dynamic>> recoveryRows = claim == null
        ? const <Map<String, dynamic>>[]
        : await _read(
            notes,
            'Claim recoveries',
            () => _rows.select(
              SupabaseTables.accidentClaimRecoveries,
              <String, Object>{'claim_id': claim.id},
              orderBy: 'recovered_at',
            ),
          );

    final List<Map<String, dynamic>> liabilityRows = await _read(
      notes,
      'The liability decision',
      () => _rows.select(
        SupabaseTables.accidentLiabilityAssessments,
        <String, Object>{'accident_id': id},
        limit: 1,
      ),
    );
    final Map<String, dynamic>? liability =
        liabilityRows.isEmpty ? null : liabilityRows.first;

    final List<Map<String, dynamic>> orderRows = await _read(
      notes,
      'The repair order',
      () => _rows.select(
        SupabaseTables.accidentRepairOrders,
        <String, Object>{'accident_id': id},
        limit: 1,
      ),
    );

    return AccidentClaimPackage(
      claim: claim,
      evidence: evidenceRows.map(evidenceFromRow).toList(growable: false),
      recoveries: recoveryRows.map(_recoveryFromRow).toList(growable: false),
      liabilityType: _string(liability?['liability_type']),
      ourLiabilityPct: liability?['our_liability_pct'] as num?,
      repairRoute:
          orderRows.isEmpty ? null : _string(orderRows.first['repair_route']),
      notes: List<String>.unmodifiable(notes),
    );
  }

  /// Uploads one file into the evidence bucket and records it against the
  /// insurance package row it satisfies.
  Future<AccidentEvidenceItem> uploadDocument({
    required String accidentId,
    required String requirementKey,
    required String localPath,
    required bool isPhoto,
    String? country,
    String? site,
  }) {
    if (accidentId.trim().isEmpty ||
        requirementKey.trim().isEmpty ||
        localPath.trim().isEmpty) {
      throw ArgumentError('An accident, requirement and file are required');
    }
    return guard(() async {
      final String fileName = basenameOf(localPath);
      final String ref = await _rows.uploadEvidence(
        localPath: localPath,
        fileName: fileName,
      );
      final Map<String, dynamic> row = await insertTolerant(
        _rows,
        SupabaseTables.accidentEvidence,
        core: <String, Object?>{
          'accident_id': accidentId,
          'workstream_key': 'insurance',
          'requirement_key': requirementKey,
          'kind': isPhoto ? 'photo' : 'document',
          'storage_ref': ref,
          'file_name': fileName,
          'uploaded_at': DateTime.now().toUtc().toIso8601String(),
        },
        optional: <String, Object?>{'country': country, 'site': site},
      );
      return evidenceFromRow(row);
    });
  }

  /// "Request <document>": an internal in-app communication on the case so
  /// the ask is on the record for the Command Center.
  Future<void> requestDocument({
    required String accidentId,
    required String requirementKey,
    required String documentLabel,
    required String toParty,
    String? country,
    String? site,
  }) {
    if (accidentId.trim().isEmpty || documentLabel.trim().isEmpty) {
      throw ArgumentError('An accident and document are required');
    }
    return guard(() async {
      await insertTolerant(
        _rows,
        SupabaseTables.accidentCaseCommunications,
        core: <String, Object?>{
          'accident_id': accidentId,
          'channel': 'in_app',
          'direction': 'internal',
          'subject': 'Document requested: $documentLabel',
          'body': 'The insurance claim package is missing "$documentLabel" '
              '($requirementKey). Please upload it to the case.',
          'to_party': toParty,
          'workstream_key': 'insurance',
        },
        optional: <String, Object?>{'country': country, 'site': site},
      );
    });
  }

  /// One recovery row. Recoveries stay editable after operational closure;
  /// every row carries its own timestamp, which is the audit.
  Future<AccidentClaimRecovery> addRecovery({
    required String claimId,
    required num amount,
    required String source,
    String? country,
    String? site,
  }) {
    if (claimId.trim().isEmpty ||
        !amount.isFinite ||
        amount < 0 ||
        source.trim().isEmpty) {
      throw ArgumentError('A claim, a nonnegative amount and a source');
    }
    return guard(() async {
      final Map<String, dynamic> row = await insertTolerant(
        _rows,
        SupabaseTables.accidentClaimRecoveries,
        core: <String, Object?>{
          'claim_id': claimId,
          'amount': amount,
          'source': source.trim(),
          'recovered_at': DateTime.now().toUtc().toIso8601String(),
        },
        optional: <String, Object?>{'country': country, 'site': site},
      );
      return _recoveryFromRow(row);
    });
  }

  Future<AccidentClaim> register({
    required String accidentId,
    required String insurer,
    required String policyNo,
    required String claimNo,
    required num claimAmount,
    num? deductible,
  }) =>
      _claims.register(
        accidentId: accidentId,
        insurer: insurer,
        policyNo: policyNo,
        claimNo: claimNo,
        claimAmount: claimAmount,
        deductible: deductible,
      );

  Future<List<Map<String, dynamic>>> _read(
    List<String> notes,
    String what,
    Future<List<Map<String, dynamic>>> Function() call,
  ) async {
    try {
      return await guard(call);
    } on SupabaseFailure catch (failure) {
      if (!failure.isSchemaMismatch) rethrow;
      notes.add('$what is not provisioned yet on this database.');
      return const <Map<String, dynamic>>[];
    }
  }
}

/// Inserts [core] plus [optional]; when the server rejects an optional
/// column (42703 / PGRST204) the insert is retried with [core] alone, so a
/// pending migration never blocks the write that does not need it.
Future<Map<String, dynamic>> insertTolerant(
  AccidentCaseRows rows,
  String table, {
  required Map<String, Object?> core,
  required Map<String, Object?> optional,
}) async {
  final Map<String, Object?> full = <String, Object?>{
    ...core,
    for (final MapEntry<String, Object?> e in optional.entries)
      if (e.value != null) e.key: e.value,
  };
  if (full.length == core.length) return rows.insert(table, full);
  try {
    return await rows.insert(table, full);
  } on Object catch (error) {
    if (!classifySupabaseError(error).isSchemaMismatch) rethrow;
    return rows.insert(table, core);
  }
}

AccidentEvidenceItem evidenceFromRow(Map<String, dynamic> row) =>
    AccidentEvidenceItem(
      id: _string(row['id']) ?? '',
      workstreamKey: _string(row['workstream_key']) ?? '',
      requirementKey: _string(row['requirement_key']) ?? '',
      kind: _string(row['kind']),
      storageRef: _string(row['storage_ref']),
      fileName: _string(row['file_name']),
      uploadedAt: _dateTime(row['uploaded_at'] ?? row['created_at']),
    );

AccidentClaimRecovery _recoveryFromRow(Map<String, dynamic> row) =>
    AccidentClaimRecovery(
      id: _string(row['id']) ?? '',
      amount: row['amount'] is num ? row['amount'] as num : 0,
      source: _string(row['source']),
      recoveredAt: _dateTime(row['recovered_at'] ?? row['created_at']),
      status: _string(row['status']),
    );

String? _string(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

DateTime? _dateTime(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

final accidentClaimPackageRepositoryProvider =
    Provider<AccidentClaimPackageRepository>(
  (ref) => AccidentClaimPackageRepository(
    ref.watch(accidentCaseRowsProvider),
    ref.watch(accidentClaimRepositoryProvider),
  ),
);

final accidentClaimPackageProvider =
    FutureProvider.autoDispose.family<AccidentClaimPackage, String>(
  (ref, accidentId) =>
      ref.watch(accidentClaimPackageRepositoryProvider).load(accidentId),
);
