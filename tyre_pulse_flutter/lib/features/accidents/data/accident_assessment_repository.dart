/// Mock M5 "Repair assessment report": the one damage assessment per
/// accident, its repair order and the assessment attachments.
///
/// The six parity columns (`safe_to_move`, `recovery_required`,
/// `estimated_labour_cost`, `parts_available_count`,
/// `parts_special_order_count`, `route_reason`) and the repair order's
/// `vendor_city` / `expected_duration_days` / `quotation_status` come from the
/// AUTHORED, NOT APPLIED 20260916130000 migration. Reads select every column
/// and look for them; writes send them and fall back without them on a
/// schema mismatch, reporting exactly which fields were dropped.
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_rows.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_package_repository.dart'
    show evidenceFromRow, insertTolerant;
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';

/// Parity columns on `accident_damage_assessments` (unapplied migration).
const Set<String> assessmentParityColumns = <String>{
  'safe_to_move',
  'recovery_required',
  'estimated_labour_cost',
  'parts_available_count',
  'parts_special_order_count',
  'route_reason',
};

/// Parity columns on `accident_repair_orders` (unapplied migration).
const Set<String> repairOrderParityColumns = <String>{
  'vendor_city',
  'expected_duration_days',
  'quotation_status',
};

@immutable
final class AccidentDamageAssessmentRecord {
  const AccidentDamageAssessmentRecord({
    required this.id,
    required this.damageAreas,
    required this.parityColumnsPresent,
    this.assessorName,
    this.assessedAt,
    this.visibleDamage,
    this.hiddenDamage,
    this.labourHours,
    this.labourCost,
    this.partsCost,
    this.totalCost,
    this.recommendedRoute,
    this.recommendedOffroad,
    this.totalLossPossible,
    this.specialistRequired,
    this.status,
    this.safeToMove,
    this.recoveryRequired,
    this.partsAvailable,
    this.partsSpecialOrder,
    this.routeReason,
  });

  final String id;
  final List<Map<String, Object?>> damageAreas;

  /// False when the parity columns were absent from the row: the six fields
  /// then read as "not provisioned yet", never as blank.
  final bool parityColumnsPresent;
  final String? assessorName;
  final DateTime? assessedAt;
  final String? visibleDamage;
  final String? hiddenDamage;
  final num? labourHours;
  final num? labourCost;
  final num? partsCost;
  final num? totalCost;
  final String? recommendedRoute;
  final bool? recommendedOffroad;
  final bool? totalLossPossible;
  final bool? specialistRequired;
  final String? status;
  final bool? safeToMove;
  final bool? recoveryRequired;
  final int? partsAvailable;
  final int? partsSpecialOrder;
  final String? routeReason;

  bool get isSubmitted => status?.trim().toLowerCase() == 'submitted';
}

@immutable
final class AccidentRepairOrderRecord {
  const AccidentRepairOrderRecord({
    required this.id,
    required this.parityColumnsPresent,
    this.repairRoute,
    this.workshopName,
    this.quotationAmount,
    this.plannedCompletion,
    this.status,
    this.vendorCity,
    this.expectedDurationDays,
    this.quotationStatus,
  });

  final String id;
  final bool parityColumnsPresent;
  final String? repairRoute;
  final String? workshopName;
  final num? quotationAmount;
  final DateTime? plannedCompletion;
  final String? status;
  final String? vendorCity;
  final int? expectedDurationDays;
  final String? quotationStatus;
}

@immutable
final class AccidentAssessmentBundle {
  const AccidentAssessmentBundle({
    required this.evidence,
    required this.notes,
    this.assessment,
    this.repairOrder,
  });

  final AccidentDamageAssessmentRecord? assessment;
  final AccidentRepairOrderRecord? repairOrder;
  final List<AccidentEvidenceItem> evidence;
  final List<String> notes;
}

/// What the assessor typed. Nulls are "not set", never zero.
@immutable
final class AccidentAssessmentDraft {
  const AccidentAssessmentDraft({
    this.safeToMove,
    this.recoveryRequired,
    this.recommendedOffroad,
    this.labourHours,
    this.labourCost,
    this.partsCost,
    this.partsAvailable,
    this.partsSpecialOrder,
    this.recommendedRoute,
    this.routeReason,
    this.totalLossPossible,
    this.workshopName,
    this.vendorCity,
    this.expectedDurationDays,
    this.quotationStatus,
    this.damageAreas,
  });

  final bool? safeToMove;
  final bool? recoveryRequired;
  final bool? recommendedOffroad;
  final num? labourHours;
  final num? labourCost;
  final num? partsCost;
  final int? partsAvailable;
  final int? partsSpecialOrder;
  final String? recommendedRoute;
  final String? routeReason;
  final bool? totalLossPossible;
  final String? workshopName;
  final String? vendorCity;
  final int? expectedDurationDays;
  final String? quotationStatus;

  /// When null the stored `damage_areas` are left untouched.
  final List<Map<String, Object?>>? damageAreas;
}

/// The outcome of a save: what landed and which parity fields the database
/// could not take yet.
@immutable
final class AccidentAssessmentSaveResult {
  const AccidentAssessmentSaveResult({
    required this.assessment,
    required this.droppedFields,
    this.repairOrder,
  });

  final AccidentDamageAssessmentRecord assessment;
  final AccidentRepairOrderRecord? repairOrder;
  final List<String> droppedFields;
}

class AccidentAssessmentRepository with SupabaseGateway {
  AccidentAssessmentRepository(this._rows);

  final AccidentCaseRows _rows;

  Future<AccidentAssessmentBundle> load(String accidentId) async {
    final String id = accidentId.trim();
    if (id.isEmpty) throw ArgumentError('An accident id is required');
    final List<String> notes = <String>[];

    final List<Map<String, dynamic>> assessments = await _read(
      notes,
      'The damage assessment',
      () => _rows.select(
        SupabaseTables.accidentDamageAssessments,
        <String, Object>{'accident_id': id},
        limit: 1,
      ),
    );
    final List<Map<String, dynamic>> orders = await _read(
      notes,
      'The repair order',
      () => _rows.select(
        SupabaseTables.accidentRepairOrders,
        <String, Object>{'accident_id': id},
        limit: 1,
      ),
    );
    final List<Map<String, dynamic>> evidence = await _read(
      notes,
      'Assessment attachments',
      () => _rows.select(
        SupabaseTables.accidentEvidence,
        <String, Object>{'accident_id': id, 'workstream_key': 'assessment'},
        orderBy: 'uploaded_at',
      ),
    );

    final AccidentDamageAssessmentRecord? assessment =
        assessments.isEmpty ? null : assessmentFromRow(assessments.first);
    if (assessment != null && !assessment.parityColumnsPresent) {
      notes.add(
        'Safety, labour cost, parts availability and route reason are not '
        'provisioned yet on this database.',
      );
    }
    final AccidentRepairOrderRecord? order =
        orders.isEmpty ? null : repairOrderFromRow(orders.first);
    if (order != null && !order.parityColumnsPresent) {
      notes.add(
        'Vendor city, expected duration and quotation status are not '
        'provisioned yet on this database.',
      );
    }
    return AccidentAssessmentBundle(
      assessment: assessment,
      repairOrder: order,
      evidence: evidence.map(evidenceFromRow).toList(growable: false),
      notes: List<String>.unmodifiable(notes),
    );
  }

  /// Saves the assessment (insert or update) and, when a route is chosen,
  /// the repair order. [submit] stamps `assessment_status = submitted`.
  Future<AccidentAssessmentSaveResult> save({
    required String accidentId,
    required AccidentAssessmentDraft draft,
    required String? existingAssessmentId,
    required String? existingRepairOrderId,
    bool submit = false,
    String? assessorName,
    String? country,
    String? site,
  }) {
    if (accidentId.trim().isEmpty) {
      throw ArgumentError('An accident id is required');
    }
    if (submit && (draft.recommendedRoute ?? '').trim().isEmpty) {
      throw ArgumentError('A repair route is required to submit');
    }
    return guard(() async {
      final List<String> dropped = <String>[];
      final num? total = draft.labourCost == null && draft.partsCost == null
          ? null
          : (draft.labourCost ?? 0) + (draft.partsCost ?? 0);
      final Map<String, Object?> core = <String, Object?>{
        'accident_id': accidentId,
        'assessed_at': DateTime.now().toUtc().toIso8601String(),
        'estimated_labour_hours': draft.labourHours,
        'estimated_parts_cost': draft.partsCost,
        'estimated_total_cost': total,
        'recommended_route': _nullIfBlank(draft.recommendedRoute),
        'recommended_offroad': draft.recommendedOffroad,
        'total_loss_possible': draft.totalLossPossible,
        if (draft.damageAreas != null) 'damage_areas': draft.damageAreas,
        if (submit) 'assessment_status': 'submitted',
        if (assessorName != null && assessorName.trim().isNotEmpty)
          'assessor_name': assessorName.trim(),
      };
      final Map<String, Object?> parity = <String, Object?>{
        'safe_to_move': draft.safeToMove,
        'recovery_required': draft.recoveryRequired,
        'estimated_labour_cost': draft.labourCost,
        'parts_available_count': draft.partsAvailable,
        'parts_special_order_count': draft.partsSpecialOrder,
        'route_reason': _nullIfBlank(draft.routeReason),
      };
      final Map<String, dynamic> saved = await _writeTolerant(
        SupabaseTables.accidentDamageAssessments,
        existingId: existingAssessmentId,
        core: core,
        optional: <String, Object?>{
          ...parity,
          'country': country,
          'site': site,
        },
        droppedFields: dropped,
        parityKeys: assessmentParityColumns,
      );

      AccidentRepairOrderRecord? order;
      final String? route = _nullIfBlank(draft.recommendedRoute);
      if (route != null) {
        final Map<String, dynamic> orderRow = await _writeTolerant(
          SupabaseTables.accidentRepairOrders,
          existingId: existingRepairOrderId,
          core: <String, Object?>{
            'accident_id': accidentId,
            'repair_route': route,
            'workshop_name': _nullIfBlank(draft.workshopName),
          },
          optional: <String, Object?>{
            'vendor_city': _nullIfBlank(draft.vendorCity),
            'expected_duration_days': draft.expectedDurationDays,
            'quotation_status': _nullIfBlank(draft.quotationStatus),
            'country': country,
            'site': site,
          },
          droppedFields: dropped,
          parityKeys: repairOrderParityColumns,
        );
        order = repairOrderFromRow(orderRow);
      }
      return AccidentAssessmentSaveResult(
        assessment: assessmentFromRow(saved),
        repairOrder: order,
        droppedFields: List<String>.unmodifiable(dropped),
      );
    });
  }

  Future<AccidentEvidenceItem> uploadAttachment({
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
          'workstream_key': 'assessment',
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

  /// Insert or update with the optional columns; on a schema mismatch retry
  /// with the core columns only and record which parity keys were dropped.
  Future<Map<String, dynamic>> _writeTolerant(
    String table, {
    required String? existingId,
    required Map<String, Object?> core,
    required Map<String, Object?> optional,
    required List<String> droppedFields,
    required Set<String> parityKeys,
  }) async {
    final Map<String, Object?> present = <String, Object?>{
      for (final MapEntry<String, Object?> e in optional.entries)
        if (e.value != null) e.key: e.value,
    };
    Future<Map<String, dynamic>> write(Map<String, Object?> row) =>
        existingId == null
            ? _rows.insert(table, row)
            : _rows.update(table, existingId, row);
    if (present.isEmpty) return write(core);
    try {
      return await write(<String, Object?>{...core, ...present});
    } on Object catch (error) {
      if (!classifySupabaseError(error).isSchemaMismatch) rethrow;
      droppedFields.addAll(present.keys.where(parityKeys.contains));
      return write(core);
    }
  }

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

AccidentDamageAssessmentRecord assessmentFromRow(Map<String, dynamic> row) {
  final Object? areas = row['damage_areas'];
  return AccidentDamageAssessmentRecord(
    id: _string(row['id']) ?? '',
    damageAreas: <Map<String, Object?>>[
      if (areas is Iterable<Object?>)
        for (final Object? a in areas)
          if (a is Map) Map<String, Object?>.from(a),
    ],
    parityColumnsPresent: assessmentParityColumns.every(row.containsKey),
    assessorName: _string(row['assessor_name']),
    assessedAt: _dateTime(row['assessed_at']),
    visibleDamage: _string(row['visible_damage']),
    hiddenDamage: _string(row['hidden_damage']),
    labourHours: row['estimated_labour_hours'] as num?,
    labourCost: row['estimated_labour_cost'] as num?,
    partsCost: row['estimated_parts_cost'] as num?,
    totalCost: row['estimated_total_cost'] as num?,
    recommendedRoute: _string(row['recommended_route']),
    recommendedOffroad: row['recommended_offroad'] as bool?,
    totalLossPossible: row['total_loss_possible'] as bool?,
    specialistRequired: row['specialist_required'] as bool?,
    status: _string(row['assessment_status']),
    safeToMove: row['safe_to_move'] as bool?,
    recoveryRequired: row['recovery_required'] as bool?,
    partsAvailable: _int(row['parts_available_count']),
    partsSpecialOrder: _int(row['parts_special_order_count']),
    routeReason: _string(row['route_reason']),
  );
}

AccidentRepairOrderRecord repairOrderFromRow(Map<String, dynamic> row) =>
    AccidentRepairOrderRecord(
      id: _string(row['id']) ?? '',
      parityColumnsPresent: repairOrderParityColumns.every(row.containsKey),
      repairRoute: _string(row['repair_route']),
      workshopName: _string(row['workshop_name']),
      quotationAmount: row['quotation_amount'] as num?,
      plannedCompletion: _dateTime(row['planned_completion']),
      status: _string(row['status']),
      vendorCity: _string(row['vendor_city']),
      expectedDurationDays: _int(row['expected_duration_days']),
      quotationStatus: _string(row['quotation_status']),
    );

String? _string(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

String? _nullIfBlank(String? value) => _string(value);

int? _int(Object? value) => value is num ? value.toInt() : null;

DateTime? _dateTime(Object? value) =>
    value is String ? DateTime.tryParse(value)?.toLocal() : null;

final accidentAssessmentRepositoryProvider =
    Provider<AccidentAssessmentRepository>(
  (ref) => AccidentAssessmentRepository(ref.watch(accidentCaseRowsProvider)),
);

final accidentAssessmentBundleProvider =
    FutureProvider.autoDispose.family<AccidentAssessmentBundle, String>(
  (ref, accidentId) =>
      ref.watch(accidentAssessmentRepositoryProvider).load(accidentId),
);
