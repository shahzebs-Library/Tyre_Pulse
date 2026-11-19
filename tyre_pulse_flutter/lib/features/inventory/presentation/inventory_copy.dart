/// The inventory screens' sentences, from one packed ARB string
/// (`inventoryCopyCatalog`, present in en/ar/ur) in the same shape as
/// `stockCountCopyCatalog`, so the whole feature adds one generated getter
/// instead of ~120.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class InventoryCopy {
  factory InventoryCopy.of(BuildContext context) =>
      InventoryCopy.parse(AppLocalizations.of(context).inventoryCopyCatalog);

  /// Parses a packed `key=value~key=value` catalog. Exposed for tests.
  factory InventoryCopy.parse(String catalog) {
    return InventoryCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')).trim():
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  InventoryCopy._(this.values);

  final Map<String, String> values;

  /// The sentence for [key]; the key itself when missing, so a gap is
  /// visible in review rather than a blank button.
  String call(String key) => values[key] ?? key;

  /// The label for a server token ([prefix] + [raw]), or the raw token when
  /// the catalog has no sentence for it (a new server status shows as itself,
  /// never as a key path).
  String label(String prefix, String raw) => values['$prefix$raw'] ?? raw;

  /// [key] with `%n` replaced by [n]. (`%` rather than braces: gen-l10n
  /// reads `{n}` in an ARB value as an ICU placeholder and would turn the
  /// catalog getter into a method.)
  String count(String key, int n) => call(key).replaceAll('%n', '$n');
}
