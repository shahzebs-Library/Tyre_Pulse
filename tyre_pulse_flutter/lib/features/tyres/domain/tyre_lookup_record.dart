/// A tyre resolved by serial number, for the search result card.
///
/// Ported from `TyreLookupRecord` in `mobile/lib/tyreLookup.ts`. Deliberately
/// narrow: this is a SEARCH RESULT, not the full tyre domain model - phase 3
/// builds only what serial search and scrap/undo need. A richer model
/// belongs to whichever later phase owns the tyre records register.
library;

/// One `tyre_records` row, shaped for the serial-search result card.
final class TyreLookupRecord {
  const TyreLookupRecord({
    required this.id,
    this.brand,
    this.size,
    this.position,
    this.tyrePosition,
    this.assetNo,
    this.site,
    this.treadDepth,
    this.pressureReading,
  });

  /// Decodes one row from the columns `lookupBySerial` selects.
  ///
  /// Throws a [FormatException] when the row has no usable `id`: a row this
  /// cannot identify cannot safely be acted on - scrap, undo and "inspect
  /// this tyre" all need it - so surfacing it as a decode failure is safer
  /// than silently returning a record nothing can be done with.
  factory TyreLookupRecord.fromRow(Map<String, dynamic> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException('tyre_records row has no usable id');
    }
    return TyreLookupRecord(
      id: rawId,
      brand: _stringOrNull(row['brand']),
      size: _stringOrNull(row['size']),
      position: _stringOrNull(row['position']),
      tyrePosition: _stringOrNull(row['tyre_position']),
      assetNo: _stringOrNull(row['asset_no']),
      site: _stringOrNull(row['site']),
      treadDepth: _stringOrNull(row['tread_depth']),
      pressureReading: _stringOrNull(row['pressure_reading']),
    );
  }

  final String id;
  final String? brand;
  final String? size;

  /// The legacy free-text position column. Prefer [tyrePosition]; kept only
  /// because the production lookup reads both and falls back to this one.
  final String? position;

  /// The canonical position code, for example `LHF1` or `RHCO`. A technical
  /// identifier: never reordered under a right-to-left locale, and never
  /// changed once assigned - see `TpIdentifierText` and `TyrePosition` in
  /// `app/router/routes.dart`.
  final String? tyrePosition;

  /// `vehicle_fleet.asset_no`. Null when this tyre is not fitted to any
  /// asset, which is a real and common state, not a data gap.
  final String? assetNo;

  final String? site;

  /// Carried as text on purpose: the source column can arrive as either a
  /// number or text depending on how the row was imported, and nothing here
  /// computes with the value - it is display-only.
  final String? treadDepth;
  final String? pressureReading;

  /// The best available position label: the canonical code, else the legacy
  /// free-text column, else null when neither was recorded.
  String? get bestPosition => tyrePosition ?? position;

  static String? _stringOrNull(Object? raw) {
    if (raw == null) return null;
    final String text = raw.toString().trim();
    return text.isEmpty ? null : text;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TyreLookupRecord &&
          other.id == id &&
          other.brand == brand &&
          other.size == size &&
          other.position == position &&
          other.tyrePosition == tyrePosition &&
          other.assetNo == assetNo &&
          other.site == site &&
          other.treadDepth == treadDepth &&
          other.pressureReading == pressureReading;

  @override
  int get hashCode => Object.hash(
    id,
    brand,
    size,
    position,
    tyrePosition,
    assetNo,
    site,
    treadDepth,
    pressureReading,
  );

  @override
  String toString() =>
      'TyreLookupRecord(id: $id, serialAsset: $assetNo, '
      'position: $bestPosition)';
}
