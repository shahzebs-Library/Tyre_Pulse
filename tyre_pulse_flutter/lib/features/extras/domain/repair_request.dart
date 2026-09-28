/// Repair Request (RFR) domain: the vocabulary and the exact row the phone
/// sends to `public.repair_requests` (V608).
///
/// Ported from `mobile/lib/repairRequest.ts`. The column list below was
/// checked against the LIVE table on 2026-09-28 (information_schema), not
/// against the in-flight migration file: `asset_no` and `description` are
/// NOT NULL, `priority` is CHECK-constrained to Low/Medium/High/Critical,
/// `status` defaults to `submitted`, and `rfr_no` is minted SERVER-SIDE by
/// the `trg_repair_requests_mint_rfr` trigger. The phone never invents an RFR
/// number: a reference that matches nothing in the ERP is worse than none.
///
/// `client_uuid` carries a partial unique index
/// (`repair_requests_client_uuid_uidx`), so a retried submit after a lost
/// response can never create two requests for the same fault.
library;

/// Fault categories, in the order a driver most often reports them.
/// Stored verbatim in `repair_requests.fault_category` (free text, no CHECK),
/// matching the Expo tokens so the office sees one vocabulary.
const List<String> kRepairFaultCategories = <String>[
  'Engine',
  'Transmission',
  'Brakes',
  'Tyres',
  'Hydraulics',
  'Electrical',
  'Body',
  'Drum/Mixer',
  'Pump',
  'Air System',
  'Cooling',
  'Other',
];

/// `repair_requests.priority` CHECK values, lowest first.
const List<String> kRepairPriorities = <String>[
  'Low',
  'Medium',
  'High',
  'Critical',
];

/// The column default, repeated so the form opens on the same value.
const String kRepairDefaultPriority = 'Medium';

/// The only status a phone may write. Every later status is an office action.
const String kRepairStatusSubmitted = 'submitted';

/// What the form holds.
final class RepairRequestDraft {
  const RepairRequestDraft({
    required this.assetNo,
    required this.description,
    this.site,
    this.plateNo,
    this.assetDescription,
    this.faultCategory,
    this.priority = kRepairDefaultPriority,
    this.odometer,
    this.engineHours,
  });

  final String assetNo;
  final String description;
  final String? site;
  final String? plateNo;
  final String? assetDescription;
  final String? faultCategory;
  final String priority;

  /// Raw text as typed; parsed by [parseMeterReading].
  final String? odometer;
  final String? engineHours;
}

/// Who is filing. Only facts from the verified profile row.
final class RepairRequestReporter {
  const RepairRequestReporter({
    required this.userId,
    this.fullName,
    this.employeeId,
    this.country,
    this.legacySite,
  });

  final String userId;
  final String? fullName;
  final String? employeeId;
  final String? country;
  final String? legacySite;
}

/// A validation problem the form must show before anything is sent.
enum RepairRequestProblem {
  assetMissing,
  descriptionMissing,
  odometerInvalid,
  engineHoursInvalid,
}

/// The result of parsing a meter box.
sealed class MeterReading {
  const MeterReading();
}

/// Nothing typed. A blank meter is honest; zero would be a false reading.
final class MeterBlank extends MeterReading {
  const MeterBlank();
}

/// A usable, non-negative reading.
final class MeterValue extends MeterReading {
  const MeterValue(this.value);
  final num value;
}

/// Typed but not a non-negative number.
final class MeterInvalid extends MeterReading {
  const MeterInvalid();
}

/// Parses a meter box. Accepts a comma as a thousands separator or a decimal
/// comma (a lone comma followed by 1-2 digits), because field keyboards in the
/// region produce both.
MeterReading parseMeterReading(String? raw) {
  final String text = (raw ?? '').trim();
  if (text.isEmpty) return const MeterBlank();
  String normalised = text.replaceAll(' ', '');
  if (RegExp(r'^\d+,\d{1,2}$').hasMatch(normalised)) {
    normalised = normalised.replaceAll(',', '.');
  } else {
    normalised = normalised.replaceAll(',', '');
  }
  final num? value = num.tryParse(normalised);
  if (value == null || value.isNaN || value.isInfinite || value < 0) {
    return const MeterInvalid();
  }
  return MeterValue(value);
}

/// Every problem with [draft], in form order. Empty means it may be sent.
List<RepairRequestProblem> validateRepairRequest(RepairRequestDraft draft) {
  return <RepairRequestProblem>[
    if (draft.assetNo.trim().isEmpty) RepairRequestProblem.assetMissing,
    if (draft.description.trim().isEmpty)
      RepairRequestProblem.descriptionMissing,
    if (parseMeterReading(draft.odometer) is MeterInvalid)
      RepairRequestProblem.odometerInvalid,
    if (parseMeterReading(draft.engineHours) is MeterInvalid)
      RepairRequestProblem.engineHoursInvalid,
  ];
}

String? _trimOrNull(String? value) {
  final String text = (value ?? '').trim();
  return text.isEmpty ? null : text;
}

num? _meterOrNull(String? raw) {
  final MeterReading reading = parseMeterReading(raw);
  return reading is MeterValue ? reading.value : null;
}

/// Describes a machine from what the register actually carries, or null.
/// `vehicle_fleet` has no description column, so this is a composition.
String? composeAssetDescription({
  String? vehicleType,
  String? make,
  String? model,
}) {
  final List<String> parts = <String>[
    for (final String? part in <String?>[vehicleType, make, model])
      if (_trimOrNull(part) != null) part!.trim(),
  ];
  return parts.isEmpty ? null : parts.join(' / ');
}

/// The exact insert row. Every key is a verified live column; nothing the
/// server owns (`rfr_no`, `status` transitions, org, timestamps) is sent
/// except `status: submitted`, which is the column default anyway.
Map<String, Object?> buildRepairRequestRow({
  required RepairRequestDraft draft,
  required RepairRequestReporter reporter,
  required String clientUuid,
}) {
  final String priority = kRepairPriorities.contains(draft.priority)
      ? draft.priority
      : kRepairDefaultPriority;
  return <String, Object?>{
    'asset_no': draft.assetNo.trim(),
    'plate_no': _trimOrNull(draft.plateNo),
    'asset_description': _trimOrNull(draft.assetDescription),
    // The reporter's own site is the fallback, never a guess about the machine.
    'site': _trimOrNull(draft.site) ?? _trimOrNull(reporter.legacySite),
    'country': _trimOrNull(reporter.country),
    'odometer': _meterOrNull(draft.odometer),
    'engine_hours': _meterOrNull(draft.engineHours),
    'fault_category': _trimOrNull(draft.faultCategory),
    'description': draft.description.trim(),
    'priority': priority,
    'status': kRepairStatusSubmitted,
    'reported_by': reporter.userId,
    'reported_by_name':
        _trimOrNull(reporter.fullName) ?? _trimOrNull(reporter.employeeId),
    'client_uuid': clientUuid,
  };
}
