library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';

/// Strings for the stock item detail and store history screens, read from
/// one packed ARB catalog (`storeHistoryCopyCatalog`), like StockCountCopy.
/// Source lists: `lib/l10n/fragments/store_history.{en,ar,ur}.json`.
final class StoreHistoryCopy {
  factory StoreHistoryCopy.of(BuildContext context) => StoreHistoryCopy.parse(
        AppLocalizations.of(context).storeHistoryCopyCatalog,
      );

  factory StoreHistoryCopy.parse(String catalog) =>
      StoreHistoryCopy._(<String, String>{
        for (final String entry in catalog.split('~'))
          if (entry.indexOf('=') > 0)
            entry.substring(0, entry.indexOf('=')):
                entry.substring(entry.indexOf('=') + 1),
      });

  StoreHistoryCopy._(this.values);
  final Map<String, String> values;
  String call(String key) => values[key] ?? key;

  String category(MovementCategory category) => call('cat_${category.name}');

  String filter(MovementTypeFilter filter) => switch (filter) {
        MovementTypeFilter.all => call('filter_all'),
        MovementTypeFilter.receipt => call('cat_receipt'),
        MovementTypeFilter.issue => call('cat_issue'),
        MovementTypeFilter.returned => call('cat_returned'),
        MovementTypeFilter.transfer => call('cat_transfer'),
        MovementTypeFilter.adjustment => call('cat_adjustment'),
        MovementTypeFilter.erpLedger => call('cat_erpLedger'),
      };
}
