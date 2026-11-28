/// The Store item card's words, packed in one ARB value
/// (`storeItemCopyCatalog`, `key=value~key=value`) like StockCountCopy.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class StoreItemCopy {
  factory StoreItemCopy.of(BuildContext context) =>
      StoreItemCopy.parse(AppLocalizations.of(context).storeItemCopyCatalog);

  factory StoreItemCopy.parse(String catalog) {
    return StoreItemCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  StoreItemCopy._(this.values);
  final Map<String, String> values;
  String call(String key) => values[key] ?? key;
}
