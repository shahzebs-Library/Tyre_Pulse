library;

import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

final class AccidentDto {
  const AccidentDto(this.row);
  final Map<String, dynamic> row;

  AccidentRecord toDomain() => AccidentRecord(
        id: _required('id'),
        assetNo: _text('asset_no') ?? '',
        site: _text('site') ?? '',
        incidentDate: _text('incident_date') ?? '',
        referenceNo: _text('reference_no'),
        caseNo: _text('case_no'),
        location: _text('location'),
        accidentType: _text('accident_type'),
        severity: _text('severity'),
        status: _text('status'),
        currentStatus: _text('current_status'),
        workflowStage: _text('workflow_stage'),
        caseStatus: _text('case_status'),
        routeKey: _text('route_key'),
        closureLevel: _text('closure_level'),
        closureStatus: _text('closure_status'),
        description: _text('description'),
        reporterName: _text('reporter_name'),
        vehicleType: _text('vehicle_type'),
        plateNumber: _text('plate_number'),
        damageDescription: _text('damage_description'),
        damageCondition: _text('damage_condition'),
        estimatedDamageCost: _number('estimated_damage_cost'),
        driverName: _text('driver_name'),
        injuries: _bool('injuries'),
        injuryCount: _number('injury_count'),
        thirdPartyInvolved: _bool('third_party_involved'),
        policeReportNo: _text('police_report_no'),
        najmStatus: _text('najm_status'),
        najmFault: _text('najm_fault'),
        taqdeerStatus: _text('taqdeer_status'),
        taqdeerNo: _text('taqdeer_no'),
        faultStatus: _text('fault_status'),
        responsibleParty: _text('responsible_party'),
        liableParty: _text('liable_party'),
        payer: _text('payer'),
        insurer: _text('insurer'),
        policyNo: _text('policy_no'),
        insuranceClaimNo: _text('insurance_claim_no'),
        claimStatus: _text('claim_status'),
        recoveryStatus: _text('recovery_status'),
        repairType: _text('repair_type'),
        workshopName: _text('workshop_name'),
        workshopLocation: _text('workshop_location'),
        nextStep: _text('next_step'),
        releaseDate: _text('release_date'),
        expectedReleaseDate: _text('expected_release_date'),
        claimAmount: _number('claim_amount'),
        claimApprovedAmount: _number('claim_approved_amount'),
        recoveredAmount: _number('recovered_amount'),
        deductible: _number('deductible'),
        amountTransfer: _number('amount_transfer'),
        repairCost: _number('repair_cost'),
        completionOverall: _number('completion_overall'),
        photos: switch (row['photos']) {
          final List<dynamic> values => values
              .map((dynamic item) => item?.toString().trim() ?? '')
              .where((String item) => item.isNotEmpty)
              .toList(growable: false),
          _ => const <String>[],
        },
        createdAt: DateTime.tryParse(_text('created_at') ?? ''),
      );

  String _required(String key) => row[key]?.toString() ?? '';
  String? _text(String key) {
    final String value = row[key]?.toString().trim() ?? '';
    return value.isEmpty ? null : value;
  }

  num? _number(String key) => row[key] is num
      ? row[key] as num
      : num.tryParse(row[key]?.toString() ?? '');

  bool? _bool(String key) => switch (row[key]) {
        final bool value => value,
        final String value when value.toLowerCase() == 'true' => true,
        final String value when value.toLowerCase() == 'false' => false,
        _ => null,
      };
}

final class AccidentWorkstreamDto {
  const AccidentWorkstreamDto(this.row);
  final Map<String, dynamic> row;

  AccidentWorkstream toDomain() => AccidentWorkstream(
        id: row['id']?.toString() ?? '',
        key: row['workstream_key']?.toString() ?? '',
        status: row['status']?.toString(),
        required: row['required'] as bool?,
        team: row['team']?.toString(),
        ownerRole: row['owner_role']?.toString(),
        progressPct: row['progress_pct'] as num?,
        notApplicable: row['not_applicable'] as bool?,
        naReason: row['na_reason']?.toString(),
        notes: row['notes']?.toString(),
        updatedAt: DateTime.tryParse(row['updated_at']?.toString() ?? ''),
      );
}
