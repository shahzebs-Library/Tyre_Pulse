/// Bidirectional text helpers.
///
/// Spec section 52 and repository rule 10. A tyre position identifier such as
/// `FL`, `RR2`, `LHF1` or `RHCO` is a TECHNICAL IDENTIFIER, not prose. So is an
/// asset number such as `TM514`. Dropped into an Arabic or Urdu sentence, the
/// Unicode bidirectional algorithm reorders the surrounding run and the
/// identifier can be rendered reversed or split across a line in the wrong
/// order. `RR2` reading as `2RR` is not a cosmetic problem: it names a
/// different wheel.
///
/// The fix is an isolate, not a direction override. An isolate tells the
/// algorithm to treat the span as a single neutral unit and to resolve its
/// insides independently, so the surrounding Arabic keeps flowing right to
/// left and the identifier keeps its own order.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// U+2066 LEFT-TO-RIGHT ISOLATE. Written as an escape on purpose: an invisible
/// character pasted into source is impossible to review and easy to delete by
/// accident.
const String _kLeftToRightIsolate = '\u2066';

/// U+2069 POP DIRECTIONAL ISOLATE.
const String _kPopDirectionalIsolate = '\u2069';

/// Helpers for text that must not be reordered.
abstract final class TpDirection {
  /// Wraps [value] so it keeps left-to-right order wherever it is placed.
  ///
  /// Use this whenever an identifier is CONCATENATED into a translated
  /// sentence. When the identifier is drawn on its own, prefer
  /// [TpIdentifierText], which also pins the widget's own direction.
  ///
  /// An empty string is returned unchanged: wrapping nothing in isolates just
  /// makes a two-character string that measures as non-empty.
  static String isolateLtr(String value) {
    if (value.isEmpty) return value;
    return '$_kLeftToRightIsolate$value$_kPopDirectionalIsolate';
  }

  /// Strips the isolate marks [isolateLtr] adds.
  ///
  /// Needed before a comparison or a database write: an isolated `FL` is not
  /// equal to `FL`, and storing the marks would corrupt a tyre position that
  /// repository rule 10 says must never change.
  static String stripIsolates(String value) {
    return value
        .replaceAll(_kLeftToRightIsolate, '')
        .replaceAll(_kPopDirectionalIsolate, '');
  }

  /// Whether the ambient locale is written right to left.
  static bool isRtl(BuildContext context) =>
      TpLocalizations.isRtl(Localizations.localeOf(context));
}

/// Draws a technical identifier so it can never be reordered.
///
/// Pins the subtree's direction to left-to-right AND isolates the string, so
/// the identifier is safe whether it is rendered alone or inside a mixed run.
class TpIdentifierText extends StatelessWidget {
  const TpIdentifierText(
    this.value, {
    this.style,
    this.maxLines,
    this.overflow,
    super.key,
  });

  /// The raw identifier. Isolate marks are added here, never stored.
  final String value;

  final TextStyle? style;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Text(
        TpDirection.isolateLtr(value),
        style: style,
        maxLines: maxLines,
        overflow: overflow,
      ),
    );
  }
}
