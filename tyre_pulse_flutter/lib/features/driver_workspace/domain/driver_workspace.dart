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
const String driverReceiptStatement =
    'I acknowledge receipt and review of this notice and submit the response shown above. '
    'Receipt does not mean admission of responsibility. A payment or recovery request '
    'does not authorize an automatic payment or payroll deduction.';

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

String driverRecordLabel(DriverRow? row) {
  if (row == null) return 'Record no longer available';
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

String? validateDriverFineResponse(DriverRow values) {
  if (!driverFineResolutions.contains(values['resolution'])) {
    return 'Choose a resolution.';
  }
  if ('${values['explanation'] ?? ''}'.trim().length < 3) {
    return 'Explain your request, including the proposed arrangement.';
  }
  if (values['resolution'] == 'already_paid' &&
      '${values['payment_reference'] ?? ''}'.trim().length < 3) {
    return 'Enter your payment reference.';
  }
  if (values['resolution'] == 'direct_payment' &&
      '${values['proposed_date'] ?? ''}'.isEmpty) {
    return 'Choose your proposed payment date.';
  }
  if (values['acknowledged'] != true ||
      '${values['signature'] ?? ''}'.isEmpty) {
    return 'Review the statement and sign before submitting.';
  }
  return null;
}
