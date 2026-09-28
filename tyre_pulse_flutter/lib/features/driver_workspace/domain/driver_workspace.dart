library;

typedef DriverRow = Map<String, Object?>;

const List<String> driverFineResolutions = <String>[
  'direct_payment',
  'already_paid',
  'dispute',
  'company_recovery',
  'instalments',
];
const List<String> driverRecordTypes = <String>[
  'driver_documents',
  'driver_training',
  'driver_coaching',
  'driver_safety_events',
  'driver_expenses',
  'tyre_records',
  'accidents',
  'wo_tasks',
  'checklist_submissions',
  'odometer_logs',
  'wash_records',
];

/// The version of the signed receipt statement the app shows. Its wording
/// lives in the ARB catalogs (`driverWsReceiptStatement`) in every language;
/// changing that wording requires a new version here.
const String driverReceiptStatementVersion = 'receipt-v1';

/// Why a driver's fine response cannot be submitted yet. The presentation
/// layer maps each value to a localized sentence.
enum DriverFineResponseIssue {
  resolution,
  explanation,
  paymentReference,
  proposedDate,
  signature,
}

final class DriverWorkspaceSnapshot {
  const DriverWorkspaceSnapshot({
    required this.data,
    this.offline = false,
    this.truncated = false,
  });
  final DriverRow data;
  final bool offline;
  final bool truncated;
  bool get canManage => !offline && data['can_manage'] == true;
  bool get canRespond => !offline && data['can_respond'] == true;
  bool get canReview => !offline && data['can_review'] == true;
  DriverRow? get driver => data['driver'] is Map
      ? Map<String, Object?>.from(data['driver']! as Map)
      : null;
  List<DriverRow> rows(String key) => driverRows(data[key]);
}

List<DriverRow> driverRows(Object? raw) => raw is List
    ? raw
        .whereType<Map<Object?, Object?>>()
        .map((Map<Object?, Object?> row) => Map<String, Object?>.from(row))
        .toList()
    : <DriverRow>[];

/// A compact label for a linked record, or null when the record no longer
/// exists (the caller renders its own localized "no longer available").
String? driverRecordLabel(DriverRow? row) {
  if (row == null) return null;
  final List<Object?> parts = <Object?>[
    row['title'] ??
        row['course_name'] ??
        row['doc_type'] ??
        row['event_type'] ??
        row['category'] ??
        row['template_name'] ??
        row['accident_type'] ??
        row['brand'],
    row['asset_no'],
    row['driver_name'],
    row['incident_date'] ??
        row['expense_date'] ??
        row['reading_date'] ??
        row['created_at'],
  ];
  final String label =
      parts.where((Object? p) => p != null && '$p'.isNotEmpty).join(' · ');
  return label.isEmpty ? '${row['id'] ?? ''}' : label;
}

DriverFineResponseIssue? validateDriverFineResponse(DriverRow values) {
  if (!driverFineResolutions.contains(values['resolution'])) {
    return DriverFineResponseIssue.resolution;
  }
  if ('${values['explanation'] ?? ''}'.trim().length < 3) {
    return DriverFineResponseIssue.explanation;
  }
  if (values['resolution'] == 'already_paid' &&
      '${values['payment_reference'] ?? ''}'.trim().length < 3) {
    return DriverFineResponseIssue.paymentReference;
  }
  if (values['resolution'] == 'direct_payment' &&
      '${values['proposed_date'] ?? ''}'.isEmpty) {
    return DriverFineResponseIssue.proposedDate;
  }
  if (values['acknowledged'] != true ||
      '${values['signature'] ?? ''}'.isEmpty) {
    return DriverFineResponseIssue.signature;
  }
  return null;
}
