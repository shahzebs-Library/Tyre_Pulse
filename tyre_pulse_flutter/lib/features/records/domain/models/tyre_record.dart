/// One `tyre_records` row, shaped for the register list row and the detail
/// sheet alike.
///
/// The production Expo screen (`mobile/app/(app)/records/index.tsx`) never
/// issues a second fetch to open the detail sheet - it reuses the exact row
/// object the list already holds. This model is built the same way, on
/// purpose: [TyreRecordsRepository.fetchById] exists for a caller that
/// genuinely needs a fresh read (a deep link, a stale-row refresh), but the
/// list-to-sheet path never needs it.
///
/// `id` is required and decoding throws when it is missing. A row this
/// cannot identify cannot be a stable list key, cannot be a paging tiebreak,
/// and cannot be reopened from the detail sheet - so treating a missing id as
/// a schema/data problem (loud) is safer than silently dropping the row
/// (which would also make a page shorter than the page size and could be
/// misread as "this is the last page").
library;

import 'package:tyre_pulse/core/errors/app_error.dart';

/// One tyre lifecycle record.
final class TyreRecord {
  const TyreRecord({
    required this.id,
    this.assetNo,
    this.serialNo,
    this.brand,
    this.site,
    this.position,
    this.tyrePosition,
    this.issueDate,
    this.riskLevel,
    this.category,
    this.costPerTyre,
    this.kmAtFitment,
    this.kmAtRemoval,
    this.description,
    this.remarks,
    this.country,
  });

  /// Decodes one row from the columns the repository selects.
  ///
  /// Throws an [AppError] of kind [AppErrorKind.validation] when the row has
  /// no usable `id`. Every other column degrades to null rather than
  /// throwing: a blank brand or a blank site is real fleet data, not a
  /// decoding failure.
  factory TyreRecord.fromRow(Map<String, dynamic> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.trim().isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'A tyre record could not be read. Try refreshing the list.',
        technical: 'tyre_records row has no usable id column',
      );
    }
    return TyreRecord(
      id: rawId,
      assetNo: _stringOrNull(row['asset_no']),
      serialNo: _stringOrNull(row['serial_no']),
      brand: _stringOrNull(row['brand']),
      site: _stringOrNull(row['site']),
      position: _stringOrNull(row['position']),
      tyrePosition: _stringOrNull(row['tyre_position']),
      issueDate: _stringOrNull(row['issue_date']),
      riskLevel: _stringOrNull(row['risk_level']),
      category: _stringOrNull(row['category']),
      costPerTyre: _numOrNull(row['cost_per_tyre']),
      kmAtFitment: _numOrNull(row['km_at_fitment']),
      kmAtRemoval: _numOrNull(row['km_at_removal']),
      description: _stringOrNull(row['description']),
      remarks: _stringOrNull(row['remarks']),
      country: _stringOrNull(row['country']),
    );
  }

  final String id;
  final String? assetNo;
  final String? serialNo;
  final String? brand;
  final String? site;

  /// The legacy free-text position column. Prefer [tyrePosition] - see
  /// [bestPosition].
  final String? position;

  /// The canonical position code, for example `LHF1` or `RHCO`. A technical
  /// identifier: never reordered under a right-to-left locale and never
  /// changed once assigned. Draw it through `TpIdentifierText` or
  /// [TpTyreChipData], never through a plain `Text`.
  final String? tyrePosition;

  /// Carried as raw text exactly as the server returned it. Never
  /// re-parsed or re-formatted: the source column is a Postgres `date`, and
  /// reparsing it through a local `DateTime` risks a timezone shift that
  /// would show a fitment on a different day from the one recorded.
  final String? issueDate;

  /// One of `Critical`, `High`, `Medium`, `Low`, or null when the tyre has
  /// never been risk-scored. This is fleet data with its own vocabulary
  /// controlled by the database, not interface text - it is never
  /// translated, matching how `TpDropdownItem.label` treats fleet data
  /// elsewhere in this design system.
  final String? riskLevel;

  final String? category;

  /// Carried as `num` rather than `double`: PostgREST can encode a Postgres
  /// `numeric` column as either a JSON number or a JSON string depending on
  /// server configuration, and `_numOrNull` accepts both without assuming
  /// which. Nothing here does currency arithmetic across records, so the
  /// precision this preserves is display-only, but it is preserved rather
  /// than silently rounded through a premature `double` cast.
  final num? costPerTyre;

  final num? kmAtFitment;
  final num? kmAtRemoval;
  final String? description;
  final String? remarks;
  final String? country;

  /// The best available position label: the canonical code, else the legacy
  /// free-text column, else null when neither was recorded.
  String? get bestPosition => tyrePosition ?? position;

  /// The distance run, when both meters were recorded and removal is
  /// genuinely after fitment. Mirrors the production screen's own guard
  /// exactly (`km_at_removal > km_at_fitment`) rather than a bare
  /// subtraction, so a reversed or equal pair of readings renders as
  /// "not available" instead of a negative or zero life nobody measured.
  num? get tyreLifeKm {
    final num? fitment = kmAtFitment;
    final num? removal = kmAtRemoval;
    if (fitment == null || removal == null) return null;
    if (removal <= fitment) return null;
    return removal - fitment;
  }

  static String? _stringOrNull(Object? raw) {
    if (raw is! String) return null;
    final String trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  /// Accepts a JSON number OR a JSON string, since PostgREST's encoding of a
  /// Postgres `numeric` column varies by server configuration and this file
  /// cannot assume which this deployment uses.
  static num? _numOrNull(Object? raw) {
    if (raw is num) return raw;
    if (raw is String) {
      final String trimmed = raw.trim();
      if (trimmed.isEmpty) return null;
      return num.tryParse(trimmed);
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TyreRecord &&
          other.id == id &&
          other.assetNo == assetNo &&
          other.serialNo == serialNo &&
          other.brand == brand &&
          other.site == site &&
          other.position == position &&
          other.tyrePosition == tyrePosition &&
          other.issueDate == issueDate &&
          other.riskLevel == riskLevel &&
          other.category == category &&
          other.costPerTyre == costPerTyre &&
          other.kmAtFitment == kmAtFitment &&
          other.kmAtRemoval == kmAtRemoval &&
          other.description == description &&
          other.remarks == remarks &&
          other.country == country;

  @override
  int get hashCode => Object.hash(
        id,
        assetNo,
        serialNo,
        brand,
        site,
        position,
        tyrePosition,
        issueDate,
        riskLevel,
        category,
        costPerTyre,
        kmAtFitment,
        kmAtRemoval,
        Object.hash(description, remarks, country),
      );

  @override
  String toString() =>
      'TyreRecord(id: $id, asset: $assetNo, serial: $serialNo, '
      'position: $bestPosition, risk: $riskLevel)';
}
