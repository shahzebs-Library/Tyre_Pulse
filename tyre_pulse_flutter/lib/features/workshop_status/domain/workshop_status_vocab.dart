/// Workshop Status controlled vocabularies.
///
/// MIRRORS `src/lib/workshopStatus/vocab.js`, the ONE source for stage, delay
/// reason and parts status values. The database stores these as plain text
/// (no CHECK) and `workshop_status_update_record` refuses anything outside the
/// lists, so a value typed differently here would be refused on save.
///
/// `test/features/workshop_status/workshop_status_vocab_drift_test.dart`
/// parses vocab.js as TEXT and compares it to these lists, so the two cannot
/// drift. CHANGE BOTH TOGETHER.
///
/// The value saved is always the English label below. Screens translate it
/// for display only (see `WorkshopStatusVocabLabels`), never on the wire.
library;

/// Every stage a record can be in, in the order the web declares them.
const List<String> kWorkshopCurrentStages = <String>[
  'Newly Reported',
  'Waiting for Diagnosis',
  'Diagnosis in Progress',
  'Repair in Progress',
  'Waiting',
  'Waiting for Parts',
  'Waiting for Approval',
  'Waiting for Manpower',
  'Waiting for External Vendor',
  'External Repair',
  'Testing',
  'Road Test',
  'QC / Inspection',
  'Ready for Release',
  'Operational Hold',
  kWorkshopReleasedStage,
];

/// The stage the daily upload sets on a vehicle that left the file.
///
/// Owner rule: such a vehicle was RELEASED, never "removed". The stored value
/// keeps the web's wording; every label on the phone says Released.
const String kWorkshopReleasedStage = 'Removed From Current Report';

/// Stages a person may pick. The released stage is set by the upload only.
final List<String> kWorkshopSelectableStages = List<String>.unmodifiable(
  kWorkshopCurrentStages.where((String s) => s != kWorkshopReleasedStage),
);

const List<String> kWorkshopDelayReasons = <String>[
  'Waiting for Spare Parts',
  'Spare Parts Not Available',
  'MR Pending',
  'PO Pending',
  'Supplier Delivery Pending',
  'Waiting for Manpower',
  'Technician Not Available',
  'Specialist Technician Required',
  'Waiting for Workshop Bay',
  'Waiting for Tools / Equipment',
  'Waiting for External Vendor',
  'Sent to External Workshop',
  'Waiting for Diagnosis',
  'Repair in Progress',
  'Waiting for Approval',
  'Waiting for Budget Approval',
  'Waiting for Vehicle Recovery / Towing',
  'Waiting for Site to Release Vehicle',
  'Waiting for Testing',
  'Waiting for Road Test',
  'Waiting for QC / Inspection',
  'Accident Repair',
  'Warranty Claim',
  'Major Engine Repair',
  'Major Gearbox Repair',
  'Electrical Issue',
  'Hydraulic Issue',
  'Tyre Related',
  'Body Repair',
  'No Operator / Driver',
  'Operational Hold',
  kWorkshopDelayReasonOther,
];

const String kWorkshopDelayReasonOther = 'Other';

const List<String> kWorkshopPartsStatuses = <String>[
  'Not Required',
  'Required',
  'Checking Store',
  'Available in Store',
  'MR Pending',
  'MR Raised',
  'MR Approved',
  'PO Pending',
  'PO Issued',
  'Supplier Confirmed',
  'In Transit',
  'Partially Received',
  'Received',
  'Not Available',
  'Alternative Part Under Review',
];

/// True when [delayReason] needs a written detailed reason (spec section 10).
bool workshopNeedsDetailedReason(String? delayReason) =>
    (delayReason ?? '').trim() == kWorkshopDelayReasonOther;

/// Translation key segment for a vocabulary value, exactly as the web's
/// `vocabKey` builds it: `'QC / Inspection'` -> `'qc_inspection'`.
String workshopVocabKey(String value) => value
    .toLowerCase()
    .replaceAll(RegExp('[^a-z0-9]+'), '_')
    .replaceAll(RegExp(r'^_|_$'), '');
