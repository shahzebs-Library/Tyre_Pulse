/// Row shape for `wash_records`, decoded once.
///
/// #mirror: `WashRecord` in `mobile/lib/wash.ts`. Column set matches that
/// file's own `WASH_COLS` exactly - AGENTS.md rule 4: never select a wider
/// column list than what is consumed.
library;

/// The two statuses a driver or supervisor picks. Default is the first.
///
/// #mirror: `WASH_STATUS_CHOICES` in `mobile/lib/wash.ts`. These are
/// DB-CHECK vocabulary - stored verbatim in English; only the on-screen
/// label is translated, exactly as `mobile/app/(app)/washing.tsx`'s own
/// comment states for [kWashTypes] below.
const List<String> kWashStatusChoices = <String>['In Progress', 'Completed'];

/// The default status when none is chosen, matching `submitWash`'s own
/// fallback in `mobile/lib/wash.ts`.
const String kWashDefaultStatus = 'In Progress';

/// `wash_records.wash_type` CHECK vocabulary, quickest-first.
///
/// #mirror: `WASH_TYPES` in `mobile/app/(app)/washing.tsx`.
const List<String> kWashTypes = <String>[
  'Exterior',
  'Interior',
  'Full',
  'Engine Bay',
  'Undercarriage',
  'Steam',
  'Waterless',
];

/// One row of `wash_records`.
final class WashRecord {
  const WashRecord({
    required this.id,
    required this.assetNo,
    this.vehicleType,
    this.washDate,
    this.washTime,
    this.washType,
    this.site,
    this.bay,
    this.washedBy,
    this.odometerKm,
    this.status,
    this.notes,
    this.photos,
    this.createdAt,
  });

  /// Throws a [FormatException] when the row has no usable `id`, mirroring
  /// `MeterReading.fromRow`'s own choice for the sibling meter-log table.
  factory WashRecord.fromRow(Map<String, dynamic> row) {
    final String id = _stringOrNull(row['id']) ?? '';
    if (id.isEmpty) {
      throw const FormatException('wash_records row has no usable id');
    }
    return WashRecord(
      id: id,
      assetNo: _stringOrNull(row['asset_no']) ?? '',
      vehicleType: _stringOrNull(row['vehicle_type']),
      washDate: _stringOrNull(row['wash_date']),
      washTime: _stringOrNull(row['wash_time']),
      washType: _stringOrNull(row['wash_type']),
      site: _stringOrNull(row['site']),
      bay: _stringOrNull(row['bay']),
      washedBy: _stringOrNull(row['washed_by']),
      odometerKm: _numOrNull(row['odometer_km']),
      status: _stringOrNull(row['status']),
      notes: _stringOrNull(row['notes']),
      photos: _stringListOrNull(row['photos']),
      createdAt: _stringOrNull(row['created_at']),
    );
  }

  final String id;
  final String assetNo;
  final String? vehicleType;

  /// `YYYY-MM-DD`.
  final String? washDate;

  /// `HH:MM`, local time at the moment the wash was saved.
  final String? washTime;

  final String? washType;
  final String? site;
  final String? bay;
  final String? washedBy;

  /// See `MeterReading.odometerKm` for why this is a plain [num].
  final num? odometerKm;

  final String? status;
  final String? notes;
  final List<String>? photos;
  final String? createdAt;

  @override
  String toString() =>
      'WashRecord(assetNo: $assetNo, washDate: $washDate, washType: $washType)';
}

String? _stringOrNull(Object? raw) {
  if (raw is! String) {
    return null;
  }
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

num? _numOrNull(Object? raw) {
  if (raw is num) {
    return raw;
  }
  if (raw is String) {
    return num.tryParse(raw.trim());
  }
  return null;
}

List<String>? _stringListOrNull(Object? raw) {
  if (raw is! List) {
    return null;
  }
  final List<String> values = <String>[
    for (final Object? item in raw)
      if (item is String && item.trim().isNotEmpty) item,
  ];
  return values.isEmpty ? null : List<String>.unmodifiable(values);
}
