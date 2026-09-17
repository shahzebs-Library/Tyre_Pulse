/// M3 Responsibility and payment: liability assessment + authority reports.
///
/// Online-only. Writes go straight to PostgREST under the signed-in user's
/// RLS; there is no queued command for these rows. The extended columns the
/// authored migration adds (payer, third-party fields, field_audit) may not
/// exist on the server yet, so every read is attempted with them first and
/// falls back to the base projection when [isMissingSchema] says the server
/// does not carry them. [AccidentLiabilityLoad.extendedProvisioned] tells the
/// screen which of the two happened; it never guesses.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_schema.dart';

/// Reads rows from [table] with every filter applied as an equality.
typedef AccidentCaseRowsRead = Future<List<Map<String, dynamic>>> Function(
  String table,
  String columns,
  Map<String, Object> filters,
);

typedef AccidentCaseRowInsert = Future<Map<String, dynamic>> Function(
  String table,
  Map<String, Object?> row,
);

typedef AccidentCaseRowUpdate = Future<Map<String, dynamic>> Function(
  String table,
  String id,
  Map<String, Object?> patch,
);

final Provider<AccidentLiabilityRepository>
    accidentLiabilityRepositoryProvider =
    Provider<AccidentLiabilityRepository>((Ref ref) {
  final SupabaseClient client = ref.watch(supabaseClientProvider);
  return AccidentLiabilityRepository(
    read: (String table, String columns, Map<String, Object> filters) {
      PostgrestFilterBuilder<PostgrestList> query =
          client.from(table).select(columns);
      for (final MapEntry<String, Object> filter in filters.entries) {
        query = query.eq(filter.key, filter.value);
      }
      return query;
    },
    insert: (String table, Map<String, Object?> row) =>
        client.from(table).insert(row).select().single(),
    update: (String table, String id, Map<String, Object?> patch) =>
        client.from(table).update(patch).eq('id', id).select().single(),
  );
});

/// Per-field provenance stored in `field_audit` jsonb.
@immutable
final class AccidentFieldAudit {
  const AccidentFieldAudit({
    this.recordedBy,
    this.recordedAt,
    this.verification,
    this.verifiedBy,
    this.verifiedAt,
  });

  factory AccidentFieldAudit.fromJson(Map<String, Object?> json) =>
      AccidentFieldAudit(
        recordedBy: accidentRowText(json['recorded_by']),
        recordedAt: accidentRowDate(json['recorded_at']),
        verification: accidentRowText(json['verification']),
        verifiedBy: accidentRowText(json['verified_by']),
        verifiedAt: accidentRowDate(json['verified_at']),
      );

  final String? recordedBy;
  final DateTime? recordedAt;

  /// One of `verified | pending | missing`, or null when never set.
  final String? verification;
  final String? verifiedBy;
  final DateTime? verifiedAt;

  AccidentFieldAudit copyWith({
    String? recordedBy,
    DateTime? recordedAt,
    String? verification,
    String? verifiedBy,
    DateTime? verifiedAt,
  }) =>
      AccidentFieldAudit(
        recordedBy: recordedBy ?? this.recordedBy,
        recordedAt: recordedAt ?? this.recordedAt,
        verification: verification ?? this.verification,
        verifiedBy: verifiedBy ?? this.verifiedBy,
        verifiedAt: verifiedAt ?? this.verifiedAt,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'recorded_by': recordedBy,
        'recorded_at': recordedAt?.toUtc().toIso8601String(),
        'verification': verification,
        'verified_by': verifiedBy,
        'verified_at': verifiedAt?.toUtc().toIso8601String(),
      };
}

@immutable
final class AccidentLiabilityAssessment {
  const AccidentLiabilityAssessment({
    this.id,
    this.liabilityType,
    this.ourLiabilityPct,
    this.thirdPartyPct,
    this.approved,
    this.locked,
    this.changeReason,
    this.payer,
    this.responsibleCompany,
    this.recoveryRequired,
    this.thirdPartyPlate,
    this.thirdPartyDriver,
    this.thirdPartyPhone,
    this.taqdeerRequired,
    this.fieldAudit = const <String, AccidentFieldAudit>{},
  });

  factory AccidentLiabilityAssessment.fromRow(Map<String, dynamic> row) {
    final Map<String, Object?> audit = accidentRowMap(row['field_audit']);
    return AccidentLiabilityAssessment(
      id: accidentRowText(row['id']),
      liabilityType: accidentRowText(row['liability_type']),
      ourLiabilityPct: accidentRowNum(row['our_liability_pct']),
      thirdPartyPct: accidentRowNum(row['third_party_pct']),
      approved: accidentRowBool(row['approved']),
      locked: accidentRowBool(row['locked']),
      changeReason: accidentRowText(row['change_reason']),
      payer: accidentRowText(row['payer']),
      responsibleCompany: accidentRowText(row['responsible_company']),
      recoveryRequired: accidentRowBool(row['recovery_required']),
      thirdPartyPlate: accidentRowText(row['third_party_plate']),
      thirdPartyDriver: accidentRowText(row['third_party_driver']),
      thirdPartyPhone: accidentRowText(row['third_party_phone']),
      taqdeerRequired: accidentRowBool(row['taqdeer_required']),
      fieldAudit: <String, AccidentFieldAudit>{
        for (final MapEntry<String, Object?> entry in audit.entries)
          entry.key: AccidentFieldAudit.fromJson(accidentRowMap(entry.value)),
      },
    );
  }

  final String? id;
  final String? liabilityType;
  final num? ourLiabilityPct;
  final num? thirdPartyPct;
  final bool? approved;
  final bool? locked;
  final String? changeReason;
  final String? payer;
  final String? responsibleCompany;
  final bool? recoveryRequired;
  final String? thirdPartyPlate;
  final String? thirdPartyDriver;
  final String? thirdPartyPhone;
  final bool? taqdeerRequired;
  final Map<String, AccidentFieldAudit> fieldAudit;

  /// Null-preserving copy. A sentinel is used for the nullable fields so a
  /// caller can clear a value on purpose.
  AccidentLiabilityAssessment copyWith({
    String? id,
    Object? liabilityType = _keep,
    Object? ourLiabilityPct = _keep,
    Object? thirdPartyPct = _keep,
    bool? approved,
    bool? locked,
    Object? changeReason = _keep,
    Object? payer = _keep,
    Object? responsibleCompany = _keep,
    Object? recoveryRequired = _keep,
    Object? thirdPartyPlate = _keep,
    Object? thirdPartyDriver = _keep,
    Object? thirdPartyPhone = _keep,
    Object? taqdeerRequired = _keep,
    Map<String, AccidentFieldAudit>? fieldAudit,
  }) =>
      AccidentLiabilityAssessment(
        id: id ?? this.id,
        liabilityType: _pick(liabilityType, this.liabilityType),
        ourLiabilityPct: _pick(ourLiabilityPct, this.ourLiabilityPct),
        thirdPartyPct: _pick(thirdPartyPct, this.thirdPartyPct),
        approved: approved ?? this.approved,
        locked: locked ?? this.locked,
        changeReason: _pick(changeReason, this.changeReason),
        payer: _pick(payer, this.payer),
        responsibleCompany: _pick(responsibleCompany, this.responsibleCompany),
        recoveryRequired: _pick(recoveryRequired, this.recoveryRequired),
        thirdPartyPlate: _pick(thirdPartyPlate, this.thirdPartyPlate),
        thirdPartyDriver: _pick(thirdPartyDriver, this.thirdPartyDriver),
        thirdPartyPhone: _pick(thirdPartyPhone, this.thirdPartyPhone),
        taqdeerRequired: _pick(taqdeerRequired, this.taqdeerRequired),
        fieldAudit: fieldAudit ?? this.fieldAudit,
      );

  Map<String, Object?> toBaseRow() => <String, Object?>{
        'liability_type': liabilityType,
        'our_liability_pct': ourLiabilityPct,
        'third_party_pct': thirdPartyPct,
        'change_reason': changeReason,
      };

  Map<String, Object?> toExtendedRow() => <String, Object?>{
        ...toBaseRow(),
        'payer': payer,
        'responsible_company': responsibleCompany,
        'recovery_required': recoveryRequired,
        'third_party_plate': thirdPartyPlate,
        'third_party_driver': thirdPartyDriver,
        'third_party_phone': thirdPartyPhone,
        'taqdeer_required': taqdeerRequired,
        'field_audit': <String, Object?>{
          for (final MapEntry<String, AccidentFieldAudit> entry
              in fieldAudit.entries)
            entry.key: entry.value.toJson(),
        },
      };
}

const Object _keep = Object();

T? _pick<T>(Object? candidate, T? current) =>
    identical(candidate, _keep) ? current : candidate as T?;

@immutable
final class AccidentAuthorityReport {
  const AccidentAuthorityReport({
    required this.authorityType,
    this.id,
    this.reportNo,
    this.reportStatus,
    this.reportDate,
  });

  factory AccidentAuthorityReport.fromRow(Map<String, dynamic> row) =>
      AccidentAuthorityReport(
        id: accidentRowText(row['id']),
        authorityType:
            accidentRowText(row['authority_type'])?.toLowerCase() ?? '',
        reportNo: accidentRowText(row['report_no']),
        reportStatus: accidentRowText(row['report_status'])?.toLowerCase(),
        reportDate: accidentRowText(row['report_date']),
      );

  final String? id;

  /// `police | najm | taqdeer` as stored.
  final String authorityType;
  final String? reportNo;

  /// `available | pending | none`.
  final String? reportStatus;
  final String? reportDate;
}

const List<String> accidentAuthorityTypes = <String>[
  'police',
  'najm',
  'taqdeer',
];

const List<String> accidentAuthorityStatuses = <String>[
  'available',
  'pending',
  'none',
];

@immutable
final class AccidentLiabilityLoad {
  const AccidentLiabilityLoad({
    required this.extendedProvisioned,
    this.assessment,
    this.authorityReports = const <AccidentAuthorityReport>[],
  });

  final AccidentLiabilityAssessment? assessment;
  final List<AccidentAuthorityReport> authorityReports;

  /// False when the server rejected the extended projection, meaning the
  /// authored migration has not been applied. Base fields still work.
  final bool extendedProvisioned;

  AccidentAuthorityReport? authority(String type) {
    for (final AccidentAuthorityReport report in authorityReports) {
      if (report.authorityType == type) return report;
    }
    return null;
  }
}

class AccidentLiabilityRepository with SupabaseGateway {
  AccidentLiabilityRepository({
    required AccidentCaseRowsRead read,
    required AccidentCaseRowInsert insert,
    required AccidentCaseRowUpdate update,
  })  : _read = read,
        _insert = insert,
        _update = update;

  final AccidentCaseRowsRead _read;
  final AccidentCaseRowInsert _insert;
  final AccidentCaseRowUpdate _update;

  static const String baseColumns =
      'id,accident_id,liability_type,our_liability_pct,third_party_pct,'
      'approved,locked,change_reason,created_at';
  static const String extendedColumns =
      '$baseColumns,payer,responsible_company,recovery_required,'
      'third_party_plate,third_party_driver,third_party_phone,'
      'taqdeer_required,field_audit';
  static const String authorityColumns =
      'id,accident_id,authority_type,report_no,report_status,report_date,'
      'created_at';

  Future<AccidentLiabilityLoad> load(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    final Map<String, Object> filter = <String, Object>{'accident_id': id};

    bool extended = true;
    List<Map<String, dynamic>> rows;
    try {
      rows = await guard(
        () => _read(
          AccidentCaseTables.liabilityAssessments,
          extendedColumns,
          filter,
        ),
      );
    } on SupabaseFailure catch (failure) {
      if (!isMissingSchema(failure)) rethrow;
      extended = false;
      rows = await guard(
        () => _read(
          AccidentCaseTables.liabilityAssessments,
          baseColumns,
          filter,
        ),
      );
    }

    final List<Map<String, dynamic>> authority = await guard(
      () => _read(
        AccidentCaseTables.authorityReports,
        authorityColumns,
        filter,
      ),
    );

    return AccidentLiabilityLoad(
      extendedProvisioned: extended,
      assessment: rows.isEmpty
          ? null
          : AccidentLiabilityAssessment.fromRow(_latest(rows)),
      authorityReports: <AccidentAuthorityReport>[
        for (final Map<String, dynamic> row in authority)
          AccidentAuthorityReport.fromRow(row),
      ],
    );
  }

  /// Inserts or updates the one assessment row for [accidentId]. When
  /// [includeExtended] is false only the live base columns are written, so a
  /// server without the migration still accepts the save.
  Future<AccidentLiabilityAssessment> save({
    required String accidentId,
    required AccidentLiabilityAssessment assessment,
    required bool includeExtended,
    String? country,
    String? site,
  }) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    final Map<String, Object?> row =
        includeExtended ? assessment.toExtendedRow() : assessment.toBaseRow();
    return guard(() async {
      final String? existingId = assessment.id;
      final Map<String, dynamic> saved = existingId == null
          ? await _insert(
              AccidentCaseTables.liabilityAssessments,
              <String, Object?>{
                'accident_id': id,
                if (country != null && country.trim().isNotEmpty)
                  'country': country.trim(),
                if (site != null && site.trim().isNotEmpty)
                  'site': site.trim(),
                ...row,
              },
            )
          : await _update(
              AccidentCaseTables.liabilityAssessments,
              existingId,
              row,
            );
      return AccidentLiabilityAssessment.fromRow(saved);
    });
  }

  Future<AccidentAuthorityReport> saveAuthorityReport({
    required String accidentId,
    required AccidentAuthorityReport report,
    String? country,
    String? site,
  }) async {
    final String id = accidentId.trim();
    if (id.isEmpty ||
        !accidentAuthorityTypes.contains(report.authorityType) ||
        (report.reportStatus != null &&
            !accidentAuthorityStatuses.contains(report.reportStatus))) {
      throw ArgumentError('Invalid authority report');
    }
    final Map<String, Object?> patch = <String, Object?>{
      'report_no': report.reportNo,
      'report_status': report.reportStatus ?? 'pending',
      'report_date': report.reportDate,
    };
    return guard(() async {
      final String? existingId = report.id;
      final Map<String, dynamic> saved = existingId == null
          ? await _insert(
              AccidentCaseTables.authorityReports,
              <String, Object?>{
                'accident_id': id,
                'authority_type': report.authorityType,
                if (country != null && country.trim().isNotEmpty)
                  'country': country.trim(),
                if (site != null && site.trim().isNotEmpty)
                  'site': site.trim(),
                ...patch,
              },
            )
          : await _update(
              AccidentCaseTables.authorityReports,
              existingId,
              patch,
            );
      return AccidentAuthorityReport.fromRow(saved);
    });
  }

  static Map<String, dynamic> _latest(List<Map<String, dynamic>> rows) {
    Map<String, dynamic> best = rows.first;
    DateTime? bestAt = accidentRowDate(best['created_at']);
    for (final Map<String, dynamic> row in rows.skip(1)) {
      final DateTime? at = accidentRowDate(row['created_at']);
      if (bestAt == null || (at != null && at.isAfter(bestAt))) {
        best = row;
        bestAt = at;
      }
    }
    return best;
  }
}
