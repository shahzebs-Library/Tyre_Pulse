/// Tolerant parsing of the odometer / hour-meter text an inspector types.
///
/// `inspections.odometer_km` is `numeric(12,1)` and `hour_meter` is
/// `numeric(10,1)` (MIGRATIONS_V21.sql), so a decimal reading is a real,
/// storable value. Field staff also type readings the way the dashboard
/// shows them - `12,345` with a thousands separator, or with stray spaces.
/// A bare `int.tryParse` turned every one of those into `null`, silently
/// dropping a reading the inspector had actually entered. This parser
/// accepts them, and when the text is non-empty but genuinely unreadable it
/// says so ([MeterReadingInput.isInvalid]) so the screen can show a
/// validation error instead of submitting the sheet without the reading.
library;

import 'package:flutter/foundation.dart';

@immutable
class MeterReadingInput {
  const MeterReadingInput._({
    required this.value,
    required this.isInvalid,
    this.looksLikeDate = false,
  });

  /// Parses [raw]. Blank -> [empty]. Thousands separators (`,`, the Arabic
  /// thousands separator U+066C), spaces and non-breaking spaces are
  /// stripped; the Arabic decimal separator U+066B is read as `.`. A
  /// negative, non-finite or otherwise unparseable value is [isInvalid].
  factory MeterReadingInput.parse(String raw) {
    final String trimmed = raw.trim();
    if (trimmed.isEmpty) return empty;
    final String cleaned = trimmed
        .replaceAll(RegExp(r'[,\u066C\u00A0\u202F\s]'), '')
        .replaceAll('\u066B', '.');
    final double? parsed = double.tryParse(cleaned);
    if (parsed == null || !parsed.isFinite || parsed < 0) {
      return const MeterReadingInput._(value: null, isInvalid: true);
    }
    // A date typed into a meter box (20261122 for 2026-11-22) was being
    // saved as twenty million km on machines that run on hours. No machine
    // reaches that reading, so a whole number that reads as a calendar
    // date is refused with its own message instead of being stored.
    if (isDateShaped(parsed)) {
      return const MeterReadingInput._(
        value: null,
        isInvalid: true,
        looksLikeDate: true,
      );
    }
    return MeterReadingInput._(value: parsed, isInvalid: false);
  }

  /// True for a whole number from 20000101 to 20991231 that is a real
  /// calendar date in YYYYMMDD form.
  static bool isDateShaped(double v) {
    if (v != v.roundToDouble() || v < 20000101 || v > 20991231) return false;
    final int n = v.toInt();
    final int y = n ~/ 10000;
    final int m = (n ~/ 100) % 100;
    final int d = n % 100;
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= DateTime(y, m + 1, 0).day;
  }

  /// Nothing typed. Not a reading, and not an error: both meters are
  /// optional.
  static const MeterReadingInput empty =
      MeterReadingInput._(value: null, isInvalid: false);

  /// The parsed reading, or null when blank or invalid. Zero is a real
  /// reading and is returned as `0.0`, never folded into null.
  final double? value;

  /// True only when something was typed and it could not be read.
  final bool isInvalid;

  /// True when what was typed is a date (YYYYMMDD), not a reading.
  final bool looksLikeDate;

  /// A whole-number view for the on-device draft, whose odometer column is
  /// an integer. Only a whole value is returned; a fractional reading is
  /// kept in the typed text and the submitted payload, never silently
  /// rounded into the draft.
  int? get wholeValue {
    final double? v = value;
    if (v == null || v != v.roundToDouble()) return null;
    return v.toInt();
  }
}
