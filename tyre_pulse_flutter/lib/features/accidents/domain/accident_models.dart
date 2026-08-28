library;

import 'package:flutter/foundation.dart';

@immutable
final class AccidentRecord {
  const AccidentRecord({
    required this.id,
    required this.assetNo,
    required this.site,
    required this.incidentDate,
    this.referenceNo,
    this.caseNo,
    this.location,
    this.accidentType,
    this.severity,
    this.status,
    this.currentStatus,
    this.workflowStage,
    this.caseStatus,
    this.routeKey,
    this.closureLevel,
    this.closureStatus,
    this.description,
    this.reporterName,
    this.vehicleType,
    this.plateNumber,
    this.damageDescription,
    this.faultStatus,
    this.responsibleParty,
    this.liableParty,
    this.payer,
    this.insurer,
    this.policyNo,
    this.insuranceClaimNo,
    this.claimStatus,
    this.recoveryStatus,
    this.repairType,
    this.workshopName,
    this.nextStep,
    this.releaseDate,
    this.expectedReleaseDate,
    this.claimAmount,
    this.claimApprovedAmount,
    this.recoveredAmount,
    this.repairCost,
    this.completionOverall,
    this.photos = const <String>[],
    this.createdAt,
  });

  final String id;
  final String assetNo;
  final String site;
  final String incidentDate;
  final String? referenceNo;
  final String? caseNo;
  final String? location;
  final String? accidentType;
  final String? severity;
  final String? status;
  final String? currentStatus;
  final String? workflowStage;
  final String? caseStatus;
  final String? routeKey;
  final String? closureLevel;
  final String? closureStatus;
  final String? description;
  final String? reporterName;
  final String? vehicleType;
  final String? plateNumber;
  final String? damageDescription;
  final String? faultStatus;
  final String? responsibleParty;
  final String? liableParty;
  final String? payer;
  final String? insurer;
  final String? policyNo;
  final String? insuranceClaimNo;
  final String? claimStatus;
  final String? recoveryStatus;
  final String? repairType;
  final String? workshopName;
  final String? nextStep;
  final String? releaseDate;
  final String? expectedReleaseDate;
  final num? claimAmount;
  final num? claimApprovedAmount;
  final num? recoveredAmount;
  final num? repairCost;
  final num? completionOverall;
  final List<String> photos;
  final DateTime? createdAt;

  String get reference =>
      _text(referenceNo) ??
      _text(caseNo) ??
      (id.length > 8 ? id.substring(0, 8).toUpperCase() : id.toUpperCase());
  String get displayStatus =>
      _text(caseStatus) ?? _text(status) ?? _text(currentStatus) ?? '';
}

enum AccidentWorkstreamChip { done, inProgress, pending, notRequired }

const List<String> accidentWorkstreamOrder = <String>[
  'incident_evidence',
  'fleet_validation',
  'liability',
  'insurance',
  'assessment',
  'repair',
  'workshop_qc',
  'handover',
  'finance',
  'corrective',
];

@immutable
final class AccidentWorkstream {
  const AccidentWorkstream({
    required this.id,
    required this.key,
    this.status,
    this.required,
    this.team,
    this.ownerRole,
    this.progressPct,
    this.notApplicable,
    this.naReason,
    this.notes,
    this.updatedAt,
  });

  final String id;
  final String key;
  final String? status;
  final bool? required;
  final String? team;
  final String? ownerRole;
  final num? progressPct;
  final bool? notApplicable;
  final String? naReason;
  final String? notes;
  final DateTime? updatedAt;

  AccidentWorkstreamChip get chip => accidentWorkstreamChipFor(
        status,
        notApplicable: notApplicable,
      );
}

AccidentWorkstreamChip accidentWorkstreamChipFor(
  String? status, {
  bool? notApplicable,
}) {
  if (notApplicable == true) return AccidentWorkstreamChip.notRequired;
  return switch (status?.trim().toLowerCase()) {
    'completed' => AccidentWorkstreamChip.done,
    'not_required' || 'cancelled' => AccidentWorkstreamChip.notRequired,
    'assigned' ||
    'in_progress' ||
    'waiting_info' ||
    'waiting_approval' ||
    'waiting_external' ||
    'on_hold' ||
    'reopened' =>
      AccidentWorkstreamChip.inProgress,
    _ => AccidentWorkstreamChip.pending,
  };
}

@immutable
final class AccidentCaseSnapshot {
  const AccidentCaseSnapshot({
    required this.accident,
    required this.provisioned,
    this.workstreams = const <AccidentWorkstream>[],
  });

  final AccidentRecord accident;
  final bool provisioned;
  final List<AccidentWorkstream> workstreams;
}

@immutable
final class AccidentListPage {
  const AccidentListPage({required this.items, required this.hasMore});
  final List<AccidentRecord> items;
  final bool hasMore;
}

@immutable
final class AccidentReportInput {
  const AccidentReportInput({
    required this.assetNo,
    required this.site,
    required this.description,
    required this.incidentDate,
    required this.photoPaths,
    this.vehicleId,
    this.vehicleType,
    this.plateNumber,
    this.location,
    this.incidentTime,
    this.accidentType = 'other',
    this.severity = 'minor',
    this.notes,
  });

  final String assetNo;
  final String site;
  final String description;
  final String incidentDate;
  final List<String> photoPaths;
  final String? vehicleId;
  final String? vehicleType;
  final String? plateNumber;
  final String? location;
  final String? incidentTime;
  final String accidentType;
  final String severity;
  final String? notes;

  bool get isValid =>
      assetNo.trim().isNotEmpty &&
      site.trim().isNotEmpty &&
      description.trim().isNotEmpty &&
      photoPaths.isNotEmpty;
}

String humaniseAccidentToken(String? value) {
  final String raw = value?.trim() ?? '';
  if (raw.isEmpty) return '';
  return raw
      .split('_')
      .where((String part) => part.isNotEmpty)
      .map((String part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}
