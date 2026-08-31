library;

import 'dart:convert';

import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:uuid/uuid.dart';

final class SubmitAccidentReportInput {
  const SubmitAccidentReportInput({
    required this.assetNo,
    required this.site,
    required this.description,
    required this.severity,
    required this.accidentType,
    required this.photoLocalPaths,
    required this.damageMap,
    this.vehicleId,
    this.vehicleType,
    this.location,
    this.notes,
    this.incidentAt,
    this.plateNumber,
    this.driverName,
    this.injuries,
    this.injuryCount,
    this.thirdPartyInvolved,
    this.policeReportNo,
    this.estimatedDamageCost,
    this.currentStatus,
    this.damageCondition,
    this.faultStatus,
    this.gccLiabilityRatio,
    this.najmStatus,
    this.najmFault,
    this.taqdeerStatus,
    this.taqdeerNo,
    this.liableParty,
    this.payer,
    this.responsibleParty,
    this.insurer,
    this.policyNo,
    this.insuranceClaimNo,
    this.claimStatus,
    this.claimAmount,
    this.claimApprovedAmount,
    this.deductible,
    this.recoveredAmount,
    this.recoveryStatus,
    this.recoverySource,
    this.recoveryDate,
    this.recoveryReference,
    this.amountTransfer,
    this.repairType,
    this.workshopName,
    this.workshopLocation,
    this.repairCost,
    this.expectedReleaseDate,
    this.releaseDate,
  });

  final String assetNo;
  final String site;
  final String description;
  final String severity;
  final String accidentType;
  final List<String> photoLocalPaths;
  final AccidentDamageMap damageMap;
  final String? vehicleId;
  final String? vehicleType;
  final String? location;
  final String? notes;
  final DateTime? incidentAt;
  final String? plateNumber;
  final String? driverName;
  final bool? injuries;
  final int? injuryCount;
  final bool? thirdPartyInvolved;
  final String? policeReportNo;
  final num? estimatedDamageCost;
  final String? currentStatus;
  final String? damageCondition;
  final String? faultStatus;
  final int? gccLiabilityRatio;
  final String? najmStatus;
  final String? najmFault;
  final String? taqdeerStatus;
  final String? taqdeerNo;
  final String? liableParty;
  final String? payer;
  final String? responsibleParty;
  final String? insurer;
  final String? policyNo;
  final String? insuranceClaimNo;
  final String? claimStatus;
  final num? claimAmount;
  final num? claimApprovedAmount;
  final num? deductible;
  final num? recoveredAmount;
  final String? recoveryStatus;
  final String? recoverySource;
  final DateTime? recoveryDate;
  final String? recoveryReference;
  final num? amountTransfer;
  final String? repairType;
  final String? workshopName;
  final String? workshopLocation;
  final num? repairCost;
  final DateTime? expectedReleaseDate;
  final DateTime? releaseDate;
}

abstract interface class AccidentReportRepository {
  Future<Set<String>> submit({
    required WorkspaceContext workspace,
    required SubmitAccidentReportInput input,
  });
}

/// Offline-first accident capture. The report and its durable evidence paths
/// enter the same queue transaction, so a process death cannot leave a report
/// without the media rows that belong to it.
final class OfflineAccidentReportRepository
    implements AccidentReportRepository {
  const OfflineAccidentReportRepository(this._commands);

  final QueuedCommandRepository _commands;
  static const Uuid _uuid = Uuid();

  @override
  Future<Set<String>> submit({
    required WorkspaceContext workspace,
    required SubmitAccidentReportInput input,
  }) async {
    final DateTime now = DateTime.now();
    final DateTime incidentAt = input.incidentAt ?? now;
    final List<String> photos = <String>[
      for (final String path in input.photoLocalPaths)
        if (path.trim().isNotEmpty) path.trim(),
    ];
    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.reportAccident,
      payload: <String, Object?>{
        'site': input.site.trim(),
        'asset_no': input.assetNo.trim(),
        'vehicle_id': _text(input.vehicleId),
        'reported_by': workspace.userId,
        'reporter_name': _text(workspace.fullName),
        'incident_date': _date(incidentAt),
        'incident_time': _time(incidentAt),
        'location': _text(input.location),
        'accident_type': input.accidentType.trim(),
        'severity': input.severity.trim(),
        'description': input.description.trim(),
        'injuries': input.injuries,
        'injury_count': input.injuryCount,
        'third_party_involved': input.thirdPartyInvolved,
        'police_report_no': _text(input.policeReportNo),
        'damage_description': input.damageMap.isEmpty
            ? null
            : jsonEncode(<String, Object?>{
                'version': 2,
                'marks': <Map<String, Object?>>[
                  for (final AccidentDamageMark mark in input.damageMap.marks)
                    mark.toJson(),
                ],
              }),
        'photos': photos.isEmpty ? null : photos,
        'notes': _text(input.notes),
        'status': 'reported',
        'country': workspace.activeCountry,
        'driver_name': _text(input.driverName),
        'plate_number': _text(input.plateNumber),
        'vehicle_type': _text(input.vehicleType),
        'estimated_damage_cost': input.estimatedDamageCost,
        'current_status': _text(input.currentStatus),
        'damage_condition': _text(input.damageCondition),
        'fault_status': _text(input.faultStatus),
        'gcc_liability_ratio': input.gccLiabilityRatio,
        'najm_status': _text(input.najmStatus),
        'najm_fault': _text(input.najmFault),
        'taqdeer_status': _text(input.taqdeerStatus),
        'taqdeer_no': _text(input.taqdeerNo),
        'liable_party': _text(input.liableParty),
        'payer': _text(input.payer),
        'responsible_party': _text(input.responsibleParty),
        'insurer': _text(input.insurer),
        'policy_no': _text(input.policyNo),
        'insurance_claim_no': _text(input.insuranceClaimNo),
        'claim_status': _text(input.claimStatus),
        'claim_amount': input.claimAmount,
        'claim_approved_amount': input.claimApprovedAmount,
        'deductible': input.deductible,
        'recovered_amount': input.recoveredAmount,
        'recovery_status': _text(input.recoveryStatus),
        'recovery_source': _text(input.recoverySource),
        'recovery_date':
            input.recoveryDate == null ? null : _date(input.recoveryDate!),
        'recovery_reference': _text(input.recoveryReference),
        'amount_transfer': input.amountTransfer,
        'repair_type': _text(input.repairType),
        'workshop_name': _text(input.workshopName),
        'workshop_location': _text(input.workshopLocation),
        'repair_cost': input.repairCost,
        'expected_release_date': input.expectedReleaseDate == null
            ? null
            : _date(input.expectedReleaseDate!),
        'release_date':
            input.releaseDate == null ? null : _date(input.releaseDate!),
      },
      workspace: workspace,
      now: now,
      country: workspace.activeCountry,
      idempotencyKey: 'accident_${_uuid.v4()}',
      attachments: <QueuedMediaAttachment>[
        for (int i = 0; i < photos.length; i++)
          QueuedMediaAttachment(
            localPath: photos[i],
            fileName: _basename(photos[i]),
            orderIndex: i,
            bucket: 'accident-photos',
          ),
      ],
    );
    return result.droppedFields;
  }
}

String? _text(String? raw) {
  final String value = raw?.trim() ?? '';
  return value.isEmpty ? null : value;
}

String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

String _time(DateTime value) => '${value.hour.toString().padLeft(2, '0')}:'
    '${value.minute.toString().padLeft(2, '0')}';

String _basename(String path) {
  final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
  return slash < 0 ? path : path.substring(slash + 1);
}
