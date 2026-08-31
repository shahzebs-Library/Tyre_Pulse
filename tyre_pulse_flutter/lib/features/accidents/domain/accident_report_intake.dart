/// Device-local state and validation for the accident-report intake.
///
/// This model deliberately contains no backend DTO. The live Flutter app has
/// one existing offline-first submission repository; this value preserves the
/// richer intake while it is a draft and lets the presentation adapt it to
/// that repository only at the final boundary.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

enum AccidentReportStep {
  identify,
  incident,
  peopleSafety,
  authorityThirdParty,
  damage,
  evidence,
  review,
}

@immutable
final class AccidentEvidenceRequirement {
  const AccidentEvidenceRequirement({
    required this.key,
    required this.label,
    required this.category,
    this.mandatory = true,
  });

  final String key;
  final String label;
  final String category;
  final bool mandatory;
}

/// The 13 globally mandatory rows in `07_SEED_CONFIG.md`, in configured sort
/// order. They are an offline baseline, not a replacement for server config:
/// route/type-specific additions are derived separately below and the screen
/// calls this out as its saved-on-device checklist.
const List<AccidentEvidenceRequirement> accidentBaselinePhotoRequirements =
    <AccidentEvidenceRequirement>[
  AccidentEvidenceRequirement(
    key: 'photo_full_front',
    label: 'Full front view',
    category: 'Exterior',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_full_rear',
    label: 'Full rear view',
    category: 'Exterior',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_left_side',
    label: 'Left side',
    category: 'Exterior',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_right_side',
    label: 'Right side',
    category: 'Exterior',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_front_left_corner',
    label: 'Front-left corner',
    category: 'Corner',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_front_right_corner',
    label: 'Front-right corner',
    category: 'Corner',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_rear_left_corner',
    label: 'Rear-left corner',
    category: 'Corner',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_rear_right_corner',
    label: 'Rear-right corner',
    category: 'Corner',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_damage_closeup',
    label: 'Close-up damage',
    category: 'Damage',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_scene',
    label: 'Accident scene',
    category: 'Scene',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_plate',
    label: 'Vehicle plate',
    category: 'Identity',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_odometer',
    label: 'Odometer / hour meter',
    category: 'Identity',
  ),
  AccidentEvidenceRequirement(
    key: 'photo_dashboard_lights',
    label: 'Dashboard warning lights',
    category: 'Condition',
  ),
];

const List<AccidentEvidenceRequirement> accidentOptionalDocuments =
    <AccidentEvidenceRequirement>[
  AccidentEvidenceRequirement(
    key: 'doc_driver_license',
    label: 'Driving licence',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_resident_id',
    label: 'Resident ID',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_vehicle_registration',
    label: 'Vehicle registration',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_authority_report',
    label: 'Authority / police report',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_driver_statement',
    label: 'Driver statement',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_najm_report',
    label: 'Najm report',
    category: 'Document',
    mandatory: false,
  ),
];

/// Returns the global checklist plus the scoped rows whose recorded facts
/// activate them. The server's route profile remains authoritative at sync;
/// these additions make an offline report at least as complete as the facts
/// already captured on the device imply.
List<AccidentEvidenceRequirement> evidenceRequirementsFor(
  AccidentReportIntakeDraft draft,
) {
  final List<AccidentEvidenceRequirement> result =
      List<AccidentEvidenceRequirement>.of(accidentBaselinePhotoRequirements);
  void add(String key, String label, String category) {
    result.add(
      AccidentEvidenceRequirement(
        key: key,
        label: label,
        category: category,
      ),
    );
  }

  if (draft.thirdPartyInvolved == true) {
    add('photo_other_party_vehicle', 'Other-party vehicle', 'Third party');
    add('photo_other_party_plate', 'Other-party plate', 'Third party');
  }
  if (draft.injuries == true ||
      draft.accidentType == 'injury' ||
      draft.accidentType == 'fatal') {
    add('photo_road_condition', 'Road / site condition', 'Scene');
  }
  if (draft.accidentType == 'tyre_failure' ||
      draft.accidentType == 'tyre_wheel') {
    add('photo_tyres_wheels', 'Tyres and wheels', 'Damage');
  }
  if (draft.accidentType == 'total_loss') {
    add('photo_chassis_vin', 'Chassis / VIN', 'Identity');
  }
  if (draft.accidentType == 'property_damage' ||
      draft.accidentType == 'third_party_property' ||
      draft.accidentType == 'customer_property') {
    add('photo_property_damage', 'Property damage', 'Damage');
  }
  if (draft.accidentType == 'equipment_to_vehicle') {
    add(
      'photo_equipment_attachment',
      'Equipment attachment',
      'Damage',
    );
  }
  if (draft.accidentType == 'theft') {
    add('photo_chassis_vin_theft', 'Chassis / VIN', 'Identity');
  }
  return List<AccidentEvidenceRequirement>.unmodifiable(result);
}

@immutable
final class AccidentReportIntakeDraft {
  const AccidentReportIntakeDraft({
    required this.incidentAt,
    this.vehicle,
    this.manualAssetNo = '',
    this.incidentSite = '',
    this.incidentLocation = '',
    this.meterAtIncident = '',
    this.accidentType = '',
    this.severity = 'minor',
    this.narrative = '',
    this.driverName = '',
    this.driverId = '',
    this.passengersInvolved,
    this.passengerCount = '',
    this.passengerDetails = '',
    this.injuries,
    this.injuryCount = '',
    this.injuryDetails = '',
    this.emergencyServices,
    this.emergencyDetails = '',
    this.vehicleMovable,
    this.recoveryRequired,
    this.safeToOperate,
    this.authorityInvolved,
    this.authorityType = '',
    this.authorityReportStatus = '',
    this.authorityReportNo = '',
    this.noReportReason = '',
    this.liabilityAvailable,
    this.thirdPartyInvolved,
    this.thirdPartyName = '',
    this.thirdPartyVehicle = '',
    this.thirdPartyPlate = '',
    this.thirdPartyContact = '',
    this.thirdPartyInsurer = '',
    this.policeNotified,
    this.policeReportNo = '',
    this.najmNotified,
    this.najmReference = '',
    this.driverStatement = '',
    this.witnessDetails = '',
    this.immediateAction = '',
    this.notes = '',
    this.damageMap = const AccidentDamageMap.empty(),
    this.evidencePaths = const <String, String>{},
    this.savedAt,
  });

  final VehicleAsset? vehicle;
  final String manualAssetNo;
  final DateTime incidentAt;
  final String incidentSite;
  final String incidentLocation;
  final String meterAtIncident;
  final String accidentType;
  final String severity;
  final String narrative;
  final String driverName;
  final String driverId;
  final bool? passengersInvolved;
  final String passengerCount;
  final String passengerDetails;
  final bool? injuries;
  final String injuryCount;
  final String injuryDetails;
  final bool? emergencyServices;
  final String emergencyDetails;
  final bool? vehicleMovable;
  final bool? recoveryRequired;
  final bool? safeToOperate;
  final bool? authorityInvolved;
  final String authorityType;
  final String authorityReportStatus;
  final String authorityReportNo;
  final String noReportReason;
  final bool? liabilityAvailable;
  final bool? thirdPartyInvolved;
  final String thirdPartyName;
  final String thirdPartyVehicle;
  final String thirdPartyPlate;
  final String thirdPartyContact;
  final String thirdPartyInsurer;
  final bool? policeNotified;
  final String policeReportNo;
  final bool? najmNotified;
  final String najmReference;
  final String driverStatement;
  final String witnessDetails;
  final String immediateAction;
  final String notes;
  final AccidentDamageMap damageMap;
  final Map<String, String> evidencePaths;
  final DateTime? savedAt;

  String get effectiveAssetNo =>
      _text(vehicle?.assetNo) ??
      _text(vehicle?.fleetNumber) ??
      manualAssetNo.trim();

  List<String> validationMessagesFor(AccidentReportStep step) {
    final List<String> messages = <String>[];
    switch (step) {
      case AccidentReportStep.identify:
        if (effectiveAssetNo.isEmpty) {
          messages.add('Select a fleet asset or enter an asset number.');
        }
      case AccidentReportStep.incident:
        if (incidentSite.trim().isEmpty) {
          messages.add('Incident site is required.');
        }
        if (accidentType.trim().isEmpty) {
          messages.add('Select an event type.');
        }
        if (narrative.trim().isEmpty) {
          messages.add('Describe what happened.');
        }
        if (incidentAt
            .isAfter(DateTime.now().add(const Duration(minutes: 1)))) {
          messages.add('Incident date and time cannot be in the future.');
        }
      case AccidentReportStep.peopleSafety:
        if (driverName.trim().isEmpty) {
          messages.add('Driver name is required.');
        }
        if (passengersInvolved == null ||
            injuries == null ||
            emergencyServices == null ||
            vehicleMovable == null ||
            recoveryRequired == null ||
            safeToOperate == null) {
          messages.add('Answer every people and safety question.');
        }
        if (passengersInvolved == true && passengerCount.trim().isEmpty) {
          messages.add('Record the passenger count.');
        }
        if (injuries == true &&
            (injuryCount.trim().isEmpty || injuryDetails.trim().isEmpty)) {
          messages.add('Record the injury count and details.');
        }
        if (emergencyServices == true && emergencyDetails.trim().isEmpty) {
          messages.add('Record the emergency response details.');
        }
      case AccidentReportStep.authorityThirdParty:
        if (authorityInvolved == null ||
            thirdPartyInvolved == null ||
            policeNotified == null ||
            najmNotified == null) {
          messages.add('Answer every authority and third-party question.');
        }
        if (authorityInvolved == true) {
          if (authorityType.trim().isEmpty ||
              authorityReportStatus.trim().isEmpty) {
            messages.add('Record the authority type and report status.');
          }
          if (authorityReportStatus == 'available' &&
              authorityReportNo.trim().isEmpty) {
            messages.add('Record the available authority report number.');
          }
          if (authorityReportStatus == 'none' &&
              noReportReason.trim().isEmpty) {
            messages.add('Explain why no authority report exists.');
          }
          if (liabilityAvailable == null) {
            messages.add('Record whether an authority decision is available.');
          }
        }
        if (thirdPartyInvolved == true &&
            (thirdPartyName.trim().isEmpty ||
                thirdPartyContact.trim().isEmpty ||
                (thirdPartyVehicle.trim().isEmpty &&
                    thirdPartyPlate.trim().isEmpty))) {
          messages.add(
            'Record the third party, contact, and vehicle or plate.',
          );
        }
        if (policeNotified == true && policeReportNo.trim().isEmpty) {
          messages.add('Record the police report number.');
        }
        if (najmNotified == true && najmReference.trim().isEmpty) {
          messages.add('Record the Najm reference.');
        }
      case AccidentReportStep.damage:
      // A near miss or no-damage event legitimately has no damage mark.
      case AccidentReportStep.evidence:
        final List<AccidentEvidenceRequirement> requirements =
            evidenceRequirementsFor(this);
        final int missing = requirements
            .where(
              (AccidentEvidenceRequirement item) =>
                  _text(evidencePaths[item.key]) == null,
            )
            .length;
        if (missing > 0) {
          messages.add('$missing required photograph(s) are still missing.');
        }
      case AccidentReportStep.review:
        if (driverStatement.trim().isEmpty) {
          messages.add('Driver statement is required.');
        }
    }
    return messages;
  }

  List<String> get allValidationMessages => <String>[
        for (final AccidentReportStep step in AccidentReportStep.values)
          ...validationMessagesFor(step),
      ];

  bool get isReadyToSubmit => allValidationMessages.isEmpty;

  int completedEvidenceCount(List<AccidentEvidenceRequirement> requirements) =>
      requirements
          .where(
            (AccidentEvidenceRequirement item) =>
                _text(evidencePaths[item.key]) != null,
          )
          .length;

  /// Preserves the fields that the current narrow queue DTO cannot represent
  /// in its native columns. This is intentionally readable text, not an
  /// invented backend schema; native-column integration remains a follow-up.
  String composeSubmissionNotes() {
    final List<String> lines = <String>[
      if (notes.trim().isNotEmpty) notes.trim(),
      '--- Accident intake details ---',
      'Incident local time: ${incidentAt.toIso8601String()}',
      if (meterAtIncident.trim().isNotEmpty)
        'Incident meter: ${meterAtIncident.trim()}',
      'Driver: ${driverName.trim()}',
      if (driverId.trim().isNotEmpty) 'Driver ID: ${driverId.trim()}',
      'Passengers involved: ${_yesNo(passengersInvolved)}',
      if (passengerCount.trim().isNotEmpty)
        'Passenger count: ${passengerCount.trim()}',
      if (passengerDetails.trim().isNotEmpty)
        'Passenger details: ${passengerDetails.trim()}',
      'Injuries: ${_yesNo(injuries)}',
      if (injuryCount.trim().isNotEmpty) 'Injury count: ${injuryCount.trim()}',
      if (injuryDetails.trim().isNotEmpty)
        'Injury details: ${injuryDetails.trim()}',
      'Emergency services: ${_yesNo(emergencyServices)}',
      if (emergencyDetails.trim().isNotEmpty)
        'Emergency response: ${emergencyDetails.trim()}',
      'Vehicle movable: ${_yesNo(vehicleMovable)}',
      'Recovery required: ${_yesNo(recoveryRequired)}',
      'Safe to operate: ${_yesNo(safeToOperate)}',
      'Authority involved: ${_yesNo(authorityInvolved)}',
      if (authorityType.trim().isNotEmpty) 'Authority: ${authorityType.trim()}',
      if (authorityReportStatus.trim().isNotEmpty)
        'Authority report status: ${authorityReportStatus.trim()}',
      if (authorityReportNo.trim().isNotEmpty)
        'Authority report: ${authorityReportNo.trim()}',
      if (noReportReason.trim().isNotEmpty)
        'No-report reason: ${noReportReason.trim()}',
      'Liability available: ${_yesNo(liabilityAvailable)}',
      'Third party involved: ${_yesNo(thirdPartyInvolved)}',
      if (thirdPartyName.trim().isNotEmpty)
        'Third party: ${thirdPartyName.trim()}',
      if (thirdPartyVehicle.trim().isNotEmpty)
        'Third-party vehicle: ${thirdPartyVehicle.trim()}',
      if (thirdPartyPlate.trim().isNotEmpty)
        'Third-party plate: ${thirdPartyPlate.trim()}',
      if (thirdPartyContact.trim().isNotEmpty)
        'Third-party contact: ${thirdPartyContact.trim()}',
      if (thirdPartyInsurer.trim().isNotEmpty)
        'Third-party insurer: ${thirdPartyInsurer.trim()}',
      'Police notified: ${_yesNo(policeNotified)}',
      if (policeReportNo.trim().isNotEmpty)
        'Police report: ${policeReportNo.trim()}',
      'Najm notified: ${_yesNo(najmNotified)}',
      if (najmReference.trim().isNotEmpty)
        'Najm reference: ${najmReference.trim()}',
      'Driver statement: ${driverStatement.trim()}',
      if (witnessDetails.trim().isNotEmpty)
        'Witnesses: ${witnessDetails.trim()}',
      if (immediateAction.trim().isNotEmpty)
        'Immediate action: ${immediateAction.trim()}',
      'Evidence checklist: ${evidencePaths.keys.join(', ')}',
    ];
    return lines.join('\n');
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'version': 1,
        'vehicle': _vehicleToJson(vehicle),
        'manualAssetNo': manualAssetNo,
        'incidentAt': incidentAt.toIso8601String(),
        'incidentSite': incidentSite,
        'incidentLocation': incidentLocation,
        'meterAtIncident': meterAtIncident,
        'accidentType': accidentType,
        'severity': severity,
        'narrative': narrative,
        'driverName': driverName,
        'driverId': driverId,
        'passengersInvolved': passengersInvolved,
        'passengerCount': passengerCount,
        'passengerDetails': passengerDetails,
        'injuries': injuries,
        'injuryCount': injuryCount,
        'injuryDetails': injuryDetails,
        'emergencyServices': emergencyServices,
        'emergencyDetails': emergencyDetails,
        'vehicleMovable': vehicleMovable,
        'recoveryRequired': recoveryRequired,
        'safeToOperate': safeToOperate,
        'authorityInvolved': authorityInvolved,
        'authorityType': authorityType,
        'authorityReportStatus': authorityReportStatus,
        'authorityReportNo': authorityReportNo,
        'noReportReason': noReportReason,
        'liabilityAvailable': liabilityAvailable,
        'thirdPartyInvolved': thirdPartyInvolved,
        'thirdPartyName': thirdPartyName,
        'thirdPartyVehicle': thirdPartyVehicle,
        'thirdPartyPlate': thirdPartyPlate,
        'thirdPartyContact': thirdPartyContact,
        'thirdPartyInsurer': thirdPartyInsurer,
        'policeNotified': policeNotified,
        'policeReportNo': policeReportNo,
        'najmNotified': najmNotified,
        'najmReference': najmReference,
        'driverStatement': driverStatement,
        'witnessDetails': witnessDetails,
        'immediateAction': immediateAction,
        'notes': notes,
        'damage': <Map<String, Object?>>[
          for (final AccidentDamageMark mark in damageMap.marks) mark.toJson(),
        ],
        'evidencePaths': evidencePaths,
        'savedAt': savedAt?.toIso8601String(),
      };

  static AccidentReportIntakeDraft fromJson(Map<String, dynamic> json) {
    final DateTime incidentAt =
        DateTime.tryParse(_string(json['incidentAt'])) ?? DateTime.now();
    final Map<String, String> evidence = <String, String>{};
    final Object? rawEvidence = json['evidencePaths'];
    if (rawEvidence is Map<String, dynamic>) {
      for (final MapEntry<String, dynamic> entry in rawEvidence.entries) {
        final String value = _string(entry.value).trim();
        if (value.isNotEmpty) evidence[entry.key] = value;
      }
    }
    final List<AccidentDamageMark> marks = <AccidentDamageMark>[];
    final Object? rawDamage = json['damage'];
    if (rawDamage is List<dynamic>) {
      for (final Object? rawMark in rawDamage) {
        if (rawMark is! Map<String, dynamic>) continue;
        try {
          marks.add(
            AccidentDamageMark.fromJson(
              Map<String, Object?>.from(rawMark),
            ),
          );
        } on FormatException {
          // One malformed legacy mark must not make the rest of a report
          // draft unreadable.
        }
      }
    }
    return AccidentReportIntakeDraft(
      vehicle: _vehicleFromJson(json['vehicle']),
      manualAssetNo: _string(json['manualAssetNo']),
      incidentAt: incidentAt,
      incidentSite: _string(json['incidentSite']),
      incidentLocation: _string(json['incidentLocation']),
      meterAtIncident: _string(json['meterAtIncident']),
      accidentType: _string(json['accidentType']),
      severity: _string(json['severity'], fallback: 'minor'),
      narrative: _string(json['narrative']),
      driverName: _string(json['driverName']),
      driverId: _string(json['driverId']),
      passengersInvolved: _bool(json['passengersInvolved']),
      passengerCount: _string(json['passengerCount']),
      passengerDetails: _string(json['passengerDetails']),
      injuries: _bool(json['injuries']),
      injuryCount: _string(json['injuryCount']),
      injuryDetails: _string(json['injuryDetails']),
      emergencyServices: _bool(json['emergencyServices']),
      emergencyDetails: _string(json['emergencyDetails']),
      vehicleMovable: _bool(json['vehicleMovable']),
      recoveryRequired: _bool(json['recoveryRequired']),
      safeToOperate: _bool(json['safeToOperate']),
      authorityInvolved: _bool(json['authorityInvolved']),
      authorityType: _string(json['authorityType']),
      authorityReportStatus: _string(json['authorityReportStatus']),
      authorityReportNo: _string(json['authorityReportNo']),
      noReportReason: _string(json['noReportReason']),
      liabilityAvailable: _bool(json['liabilityAvailable']),
      thirdPartyInvolved: _bool(json['thirdPartyInvolved']),
      thirdPartyName: _string(json['thirdPartyName']),
      thirdPartyVehicle: _string(json['thirdPartyVehicle']),
      thirdPartyPlate: _string(json['thirdPartyPlate']),
      thirdPartyContact: _string(json['thirdPartyContact']),
      thirdPartyInsurer: _string(json['thirdPartyInsurer']),
      policeNotified: _bool(json['policeNotified']),
      policeReportNo: _string(json['policeReportNo']),
      najmNotified: _bool(json['najmNotified']),
      najmReference: _string(json['najmReference']),
      driverStatement: _string(json['driverStatement']),
      witnessDetails: _string(json['witnessDetails']),
      immediateAction: _string(json['immediateAction']),
      notes: _string(json['notes']),
      damageMap: AccidentDamageMap.fromMarks(marks),
      evidencePaths: Map<String, String>.unmodifiable(evidence),
      savedAt: DateTime.tryParse(_string(json['savedAt'])),
    );
  }
}

String _yesNo(bool? value) => switch (value) {
      true => 'Yes',
      false => 'No',
      null => 'Not recorded',
    };

String? _text(String? raw) {
  final String value = raw?.trim() ?? '';
  return value.isEmpty ? null : value;
}

String _string(Object? raw, {String fallback = ''}) =>
    raw is String ? raw : fallback;

String? _nullableString(Object? raw) => _text(raw is String ? raw : null);

bool? _bool(Object? raw) => raw is bool ? raw : null;

Map<String, Object?>? _vehicleToJson(VehicleAsset? asset) {
  if (asset == null) return null;
  return <String, Object?>{
    'id': asset.id,
    'assetNo': asset.assetNo,
    'fleetNumber': asset.fleetNumber,
    'make': asset.make,
    'model': asset.model,
    'vehicleType': asset.vehicleType,
    'site': asset.site,
    'status': asset.status,
    'operatorName': asset.operatorName,
    'tyreSize': asset.tyreSize,
    'currentKm': asset.currentKm,
    'country': asset.country,
    'department': asset.department,
    'region': asset.region,
    'registrationNo': asset.registrationNo,
    'year': asset.year,
  };
}

VehicleAsset? _vehicleFromJson(Object? raw) {
  if (raw is! Map<String, dynamic>) return null;
  final String id = _string(raw['id']).trim();
  if (id.isEmpty) return null;
  return VehicleAsset(
    id: id,
    assetNo: _nullableString(raw['assetNo']),
    fleetNumber: _nullableString(raw['fleetNumber']),
    make: _nullableString(raw['make']),
    model: _nullableString(raw['model']),
    vehicleType: _nullableString(raw['vehicleType']),
    site: _nullableString(raw['site']),
    status: _nullableString(raw['status']),
    operatorName: _nullableString(raw['operatorName']),
    tyreSize: _nullableString(raw['tyreSize']),
    currentKm:
        raw['currentKm'] is num ? (raw['currentKm'] as num).toInt() : null,
    country: _nullableString(raw['country']),
    department: _nullableString(raw['department']),
    region: _nullableString(raw['region']),
    registrationNo: _nullableString(raw['registrationNo']),
    year: raw['year'] is num ? (raw['year'] as num).toInt() : null,
  );
}
