library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class StockCountCopy {
  factory StockCountCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).stockCountCopyCatalog;
    return StockCountCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  StockCountCopy._(this.values);
  final Map<String, String> values;
  String call(String key) => values[key] ?? _fallback[key] ?? key;

  /// English fallbacks for keys not yet in the ARB catalog
  /// (`stockCountCopyCatalog`). Add them to app_en.arb / app_ar.arb to
  /// translate; a catalog value always wins over these.
  static const Map<String, String> _fallback = <String, String>{
    'addNote': 'New stock is recorded for approval. The stock balance '
        'changes only after a reviewer identifies the item and an approver '
        'posts the quantity.',
    'addRecorded': 'Recorded for approval. A reviewer identifies the item, '
        'then an approver posts the quantity to stock.',
    'addSavedOnPhone': 'Saved on this phone for approval. It is sent when '
        'the connection is back.',
    'addNoCountry': 'Pick one country before adding stock; a store belongs '
        'to one country.',
    'addRefused': 'The new stock line was not accepted:',
  };
}
