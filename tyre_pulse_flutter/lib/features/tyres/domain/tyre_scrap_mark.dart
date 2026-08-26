/// The 'scrap' mark for a tyre serial, when one exists.
///
/// Ported from `ScrapMark` in `mobile/lib/tyreScrap.ts`. A tyre is scrapped by
/// writing exactly one row here (via the `scrap_tyre_by_serial` RPC, never a
/// direct table write - see `tyre_lookup_repository.dart`), and the presence
/// of a row for a serial and `mark_type = 'scrap'` IS the fact that the tyre
/// is scrapped. There is deliberately no separate boolean anywhere else.
library;

/// One `tyre_status_marks` row with `mark_type = 'scrap'`.
final class ScrapMark {
  const ScrapMark({required this.serial, this.reason, this.createdAt});

  /// Decodes one row from the columns `getScrapMark` selects.
  factory ScrapMark.fromRow(Map<String, dynamic> row) {
    return ScrapMark(
      serial: _stringOrNull(row['serial']) ?? '',
      reason: _stringOrNull(row['reason']),
      createdAt: _stringOrNull(row['created_at']),
    );
  }

  final String serial;
  final String? reason;

  /// The server's own timestamp text, kept unparsed. Nothing here computes
  /// with it - only displays it - and a parse failure on an unexpected
  /// format must never hide an otherwise-valid scrap mark.
  final String? createdAt;

  static String? _stringOrNull(Object? raw) {
    if (raw == null) return null;
    final String text = raw.toString().trim();
    return text.isEmpty ? null : text;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScrapMark &&
          other.serial == serial &&
          other.reason == reason &&
          other.createdAt == createdAt;

  @override
  int get hashCode => Object.hash(serial, reason, createdAt);

  @override
  String toString() => 'ScrapMark(serial: $serial, reason: $reason)';
}
