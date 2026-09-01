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
  incident,
  peopleAuthority,
  damage,
  evidenceDocuments,
  review,
}

@immutable
final class AccidentEvidenceRequirement {
  const AccidentEvidenceRequirement({
    required this.key,
    required this.label,
    required this.category,
    this.mandatory = true,
    this.damageZoneId,
  });

  final String key;
  final String label;
  final String category;
  final bool mandatory;
  final String? damageZoneId;
}

/// A single scene overview anchors the report. Close-up evidence is derived
/// from the damage marks the reporter actually selects instead of asking for
/// a fixed 13-photo vehicle checklist that is unrelated to the incident.
const List<AccidentEvidenceRequirement> accidentBaselinePhotoRequirements =
    <AccidentEvidenceRequirement>[
  AccidentEvidenceRequirement(
    key: 'photo_scene',
    label: 'Scene overview',
    category: 'Scene',
  ),
];

const List<AccidentEvidenceRequirement> accidentOptionalDocuments =
    <AccidentEvidenceRequirement>[
  AccidentEvidenceRequirement(
    key: 'doc_driving_licence',
    label: 'Driving licence',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_iqama',
    label: 'Iqama',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_istimara',
    label: 'Istimara',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_najm_report',
    label: 'Najm report',
    category: 'Document',
    mandatory: false,
  ),
  AccidentEvidenceRequirement(
    key: 'doc_taqdeer_report',
    label: 'Taqdeer report',
    category: 'Document',
    mandatory: false,
  ),
];

/// Returns only evidence relevant to the recorded incident: one overview,
/// one close-up for each exact marked side/component, and other-party photos
/// when another party is involved.
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

  for (final AccidentDamageMark mark in draft.damageMap.marks) {
    result.add(damageEvidenceRequirementFor(mark));
  }

  if (draft.thirdPartyInvolved == true) {
    add('photo_other_party_vehicle', 'Other-party vehicle', 'Third party');
    add('photo_other_party_plate', 'Other-party plate', 'Third party');
  }
  return List<AccidentEvidenceRequirement>.unmodifiable(result);
}

/// Builds the stable close-up requirement for one exact damage mark.
///
/// This is also used while a newly selected component is still open in the
/// editor and has not yet been committed to the parent map.
AccidentEvidenceRequirement damageEvidenceRequirementFor(
  AccidentDamageMark mark,
) {
  final String side = mark.effectiveView?.name ?? 'unspecified';
  final String component =
      _text(mark.areaLabel) ?? _humanizeDamageZone(mark.zoneId);
  return AccidentEvidenceRequirement(
    key: 'photo_damage_${_evidenceKeyPart(side)}_'
        '${_damageComponentKey(side, mark.zoneId)}',
    label: '${_titleCase(side)} - $component',
    category: 'Damage',
    damageZoneId: mark.zoneId,
  );
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
    this.thirdPartyInvoiceAvailable,
    this.thirdPartyInvoiceNumber = '',
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
  final bool? thirdPartyInvoiceAvailable;
  final String thirdPartyInvoiceNumber;
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
      case AccidentReportStep.incident:
        if (effectiveAssetNo.isEmpty) {
          messages.add('Select a fleet asset or enter an asset number.');
        }
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
      case AccidentReportStep.peopleAuthority:
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
        if (thirdPartyInvolved == null || najmNotified == null) {
          messages.add('Answer the third-party and Najm questions.');
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
        if (thirdPartyInvolved == true &&
            thirdPartyInvoiceAvailable == true &&
            thirdPartyInvoiceNumber.trim().isEmpty) {
          messages.add('Record the third-party invoice number.');
        }
        if (najmNotified == true && najmReference.trim().isEmpty) {
          messages.add('Record the Najm reference.');
        }
      case AccidentReportStep.damage:
      // A near miss or no-damage event legitimately has no damage mark.
      case AccidentReportStep.evidenceDocuments:
        final List<AccidentEvidenceRequirement> requirements =
            evidenceRequirementsFor(this);
        final int missing = requirements
            .where(
              (AccidentEvidenceRequirement item) =>
                  item.mandatory && !_hasEvidence(item),
            )
            .length;
        if (missing > 0) {
          messages.add('$missing required photograph(s) are still missing.');
        }
      case AccidentReportStep.review:
      // Review confirms the captured facts. Supporting documents and the
      // legacy driver-statement field are deliberately non-blocking.
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
            (AccidentEvidenceRequirement item) => _hasEvidence(item),
          )
          .length;

  bool _hasEvidence(AccidentEvidenceRequirement requirement) {
    if (_text(evidencePaths[requirement.key]) != null) return true;
    final String? zoneId = requirement.damageZoneId;
    if (zoneId == null) return false;
    return damageMap
            .markFor(zoneId)
            ?.photoReferences
            .any((String reference) => _text(reference) != null) ??
        false;
  }

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
      if (thirdPartyInvolved == true)
        'Third-party invoice available: '
            '${_yesNo(thirdPartyInvoiceAvailable)}',
      if (thirdPartyInvolved == true &&
          thirdPartyInvoiceAvailable == true &&
          thirdPartyInvoiceNumber.trim().isNotEmpty)
        'Third-party invoice number: ${thirdPartyInvoiceNumber.trim()}',
      'Najm notified: ${_yesNo(najmNotified)}',
      if (najmReference.trim().isNotEmpty)
        'Najm reference: ${najmReference.trim()}',
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
        'thirdPartyInvoiceAvailable': thirdPartyInvoiceAvailable,
        'thirdPartyInvoiceNumber': thirdPartyInvoiceNumber,
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
      const Map<String, String> legacyDocumentKeys = <String, String>{
        'doc_driver_license': 'doc_driving_licence',
        'doc_resident_id': 'doc_iqama',
        'doc_vehicle_registration': 'doc_istimara',
      };
      for (final MapEntry<String, String> alias in legacyDocumentKeys.entries) {
        final String? legacyPath = evidence[alias.key];
        if (legacyPath != null) {
          evidence.putIfAbsent(alias.value, () => legacyPath);
        }
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
      thirdPartyInvoiceAvailable: _bool(json['thirdPartyInvoiceAvailable']),
      thirdPartyInvoiceNumber: _string(json['thirdPartyInvoiceNumber']),
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

String _evidenceKeyPart(String raw) {
  final String normalized = raw
      .trim()
      .toLowerCase()
      .replaceAll(RegExp('[^a-z0-9]+'), '_')
      .replaceAll(RegExp(r'^_+|_+$'), '');
  return normalized.isEmpty ? 'area' : normalized;
}

String _damageComponentKey(String side, String zoneId) {
  final String normalizedSide = _evidenceKeyPart(side);
  final String normalizedZone = _evidenceKeyPart(zoneId);
  final String sidePrefix = '${normalizedSide}_';
  return normalizedZone.startsWith(sidePrefix)
      ? normalizedZone.substring(sidePrefix.length)
      : normalizedZone;
}

String _humanizeDamageZone(String raw) {
  final String value = raw
      .trim()
      .replaceAll(RegExp('[_:]+'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ');
  return value.isEmpty ? 'Selected area' : _titleCase(value);
}

String _titleCase(String raw) {
  final String value = raw.trim();
  if (value.isEmpty) return value;
  return '${value[0].toUpperCase()}${value.substring(1)}';
}

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
