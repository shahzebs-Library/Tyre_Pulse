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
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
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
    this.recipients = const <ClaimNotifyRecipient>[],
    this.liabilityType,
    this.ourLiabilityPct,
    this.repairRoute,
    this.caseCountry,
  });

  final AccidentClaim? claim;
  final List<AccidentEvidenceItem> evidence;
  final List<AccidentClaimRecovery> recoveries;

  /// Honest "not provisioned yet" notes for reads that hit a missing table
  /// or column instead of silently rendering as empty.
  final List<String> notes;
  final String? liabilityType;
  final num? ourLiabilityPct;

  /// `accident_repair_orders.repair_route` (internal / external / on_site):
  /// the chosen route raises the M4 banner.
  final String? repairRoute;

  /// `accidents.country` of the case itself. Money is labelled with a
  /// currency only when the workspace is on this same country, so a case is
  /// never shown in another country's currency.
  final String? caseCountry;

  /// "After registration notify" chips, resolved to real people.
  final List<ClaimNotifyRecipient> recipients;
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

    // The live table keys recoveries on the case (`accident_id`); it has no
    // `claim_id` column. Newest row first: it is the "last updated" one.
    final List<Map<String, dynamic>> recoveryRows = await _read(
      notes,
      'Claim recoveries',
      () => _rows.select(
        SupabaseTables.accidentClaimRecoveries,
        <String, Object>{'accident_id': id},
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

    final String? caseCountry = await _caseCountry(id);
    final List<ClaimNotifyRecipient> recipients = await _recipients(id);

    return AccidentClaimPackage(
      claim: claim,
      caseCountry: caseCountry,
      recipients: recipients,
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

  /// "Request `<document>`": an internal in-app communication on the case so
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

  /// One recovery row against the case. Recoveries stay editable after
  /// operational closure; every row carries its own timestamps, which is the
  /// audit. [source] must be one of [claimRecoverySources] (the live CHECK)
  /// and the row is written as `recovered`, because the amount entered is
  /// money that arrived.
  Future<AccidentClaimRecovery> addRecovery({
    required String accidentId,
    required num amount,
    required String source,
    String? currency,
    String? country,
    String? site,
    DateTime? now,
  }) {
    final String token = source.trim();
    if (accidentId.trim().isEmpty ||
        !amount.isFinite ||
        amount < 0 ||
        !claimRecoverySources.contains(token)) {
      throw ArgumentError('A case, a nonnegative amount and a known source');
    }
    final DateTime day = (now ?? DateTime.now()).toLocal();
    final String date = '${day.year.toString().padLeft(4, '0')}-'
        '${day.month.toString().padLeft(2, '0')}-'
        '${day.day.toString().padLeft(2, '0')}';
    return guard(() async {
      final Map<String, dynamic> row = await insertTolerant(
        _rows,
        SupabaseTables.accidentClaimRecoveries,
        core: <String, Object?>{
          'accident_id': accidentId,
          'amount': amount,
          'source': token,
          'status': 'recovered',
          'recovered_at': date,
        },
        optional: <String, Object?>{
          'currency': currency,
          'country': country,
          'site': site,
        },
      );
      return _recoveryFromRow(row);
    });
  }

  /// The case's own country; unreadable reads as unknown, never a guess.
  Future<String?> _caseCountry(String id) async {
    try {
      final List<Map<String, dynamic>> rows = await guard(
        () => _rows.select(
          SupabaseTables.accidents,
          <String, Object>{'id': id},
          limit: 1,
        ),
      );
      return rows.isEmpty ? null : _string(rows.first['country']);
    } on Object {
      return null;
    }
  }

  /// Real people behind each notify chip: the workstream owner when one is
  /// assigned, else the approved, unlocked profiles holding the team's
  /// configured roles. A failed read leaves the chip on its role label.
  Future<List<ClaimNotifyRecipient>> _recipients(String id) async {
    Map<String, String> owners = const <String, String>{};
    try {
      final List<Map<String, dynamic>> streams = await guard(
        () => _rows.select(
          SupabaseTables.accidentCaseWorkstreams,
          <String, Object>{'accident_id': id},
        ),
      );
      owners = <String, String>{
        for (final Map<String, dynamic> w in streams)
          if (_string(w['workstream_key']) != null &&
              _string(w['owner_id']) != null)
            _string(w['workstream_key'])!: _string(w['owner_id'])!,
      };
    } on Object {
      owners = const <String, String>{};
    }
    final List<ClaimNotifyRecipient> out = <ClaimNotifyRecipient>[];
    for (final NotifyRole role in notifyRoles) {
      if (!claimNotifyRoleKeys.contains(role.key)) continue;
      final String? stream = notifyRoleWorkstream[role.key];
      final String? ownerId = stream == null ? null : owners[stream];
      List<String> names = const <String>[];
      if (ownerId != null) {
        names = await _profileNames(<String, Object>{'id': ownerId});
      }
      if (names.isEmpty) {
        final Set<String> seen = <String>{};
        for (final String r in role.roles) {
          seen.addAll(
            await _profileNames(<String, Object>{'role': r, 'approved': true}),
          );
        }
        names = seen.toList(growable: false)..sort();
      }
      out.add(
        ClaimNotifyRecipient(
          roleKey: role.key,
          names: names,
          fallbackRole: role.roles.isEmpty ? role.label : role.roles.first,
          visibilityOnly: role.visibilityOnly,
        ),
      );
    }
    return List<ClaimNotifyRecipient>.unmodifiable(out);
  }

  Future<List<String>> _profileNames(Map<String, Object> eq) async {
    try {
      final List<Map<String, dynamic>> rows = await guard(
        () => _rows.select(SupabaseTables.profiles, eq, limit: 50),
      );
      return <String>[
        for (final Map<String, dynamic> p in rows)
          if (p['locked'] != true)
            if (_string(p['full_name']) ?? _string(p['username'])
                case final String name)
              name,
      ];
    } on Object {
      return const <String>[];
    }
  }

  Future<AccidentClaim> register({
    required String accidentId,
    required String insurer,
    required String policyNo,
    required num claimAmount,
    String? claimNo,
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
      recoveredAt: _dateTime(row['recovered_at']),
      updatedAt: _dateTime(row['updated_at'] ?? row['created_at']),
      status: _string(row['status']),
    );

String? _string(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

DateTime? _dateTime(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

/// The notify roles mock M4 prints under "After registration notify".
const List<String> claimNotifyRoleKeys = <String>[
  'fleet',
  'workshop',
  'command_center',
  'pmv_manager',
];

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
