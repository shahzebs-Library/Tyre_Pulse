/// Row shapes for `odometer_logs`, decoded once.
///
/// #mirror: `MeterReading` / `LastReading` in `mobile/lib/meterLogs.ts`.
/// Column set matches that file's own `ODO_COLS` exactly - AGENTS.md rule 4:
/// never select a wider column list than what is consumed.
library;

/// One row of `odometer_logs`, for the recent-readings list.
final class MeterReading {
  const MeterReading({
    required this.id,
    required this.assetNo,
    this.odometerKm,
    this.readingDate,
    this.site,
    this.source,
    this.notes,
    this.photos,
    this.createdAt,
  });

  /// Throws a [FormatException] when the row has no usable `id` - a row a
  /// caller cannot identify cannot be shown as a distinct list entry, the
  /// same reason `AssetLookupRecord.fromRow`
  /// (`lib/features/scanning/domain/scan_lookup.dart`) gives for the same
  /// choice over the same kind of row.
  factory MeterReading.fromRow(Map<String, dynamic> row) {
    final String id = _stringOrNull(row['id']) ?? '';
    if (id.isEmpty) {
      throw const FormatException('odometer_logs row has no usable id');
    }
    return MeterReading(
      id: id,
      assetNo: _stringOrNull(row['asset_no']) ?? '',
      odometerKm: _numOrNull(row['odometer_km']),
      readingDate: _stringOrNull(row['reading_date']),
      site: _stringOrNull(row['site']),
      source: _stringOrNull(row['source']),
      notes: _stringOrNull(row['notes']),
      photos: _stringListOrNull(row['photos']),
      createdAt: _stringOrNull(row['created_at']),
    );
  }

  final String id;
  final String assetNo;

  /// Nullable, and it must stay nullable - a fabricated `0` would read as a
  /// real reading (`VehicleAsset.currentKm`'s own rule, over the sibling
  /// `vehicle_fleet.current_km` column). Carried as a plain [num] rather
  /// than [int] because a Postgres numeric column decodes as either an
  /// `int` or a `double` depending on the stored value, and the reference
  /// screen's own odometer input accepts a decimal point - the same
  /// reasoning `AssetLookupRecord.currentKm`
  /// (`lib/features/scanning/domain/scan_lookup.dart`) already gives for the
  /// sibling column.
  final num? odometerKm;

  /// `YYYY-MM-DD`.
  final String? readingDate;
  final String? site;
  final String? source;
  final String? notes;
  final List<String>? photos;
  final String? createdAt;

  @override
  String toString() =>
      'MeterReading(assetNo: $assetNo, odometerKm: $odometerKm, '
      'readingDate: $readingDate)';
}

/// The most recent odometer reading for one asset, used both for the
/// below-last-reading warning and for the "Last reading" display panel.
///
/// #mirror: `LastReading` in `mobile/lib/meterLogs.ts`.
final class LastOdometerReading {
  const LastOdometerReading({this.odometerKm, this.readingDate});

  /// See [MeterReading.odometerKm] for why this is a plain [num].
  final num? odometerKm;
  final String? readingDate;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LastOdometerReading &&
          other.odometerKm == odometerKm &&
          other.readingDate == readingDate);

  @override
  int get hashCode => Object.hash(odometerKm, readingDate);

  @override
  String toString() =>
      'LastOdometerReading(odometerKm: $odometerKm, readingDate: $readingDate)';
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
