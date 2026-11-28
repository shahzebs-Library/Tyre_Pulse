/// Strings for Workshop Status vehicle intake on the phone, read from one
/// packed ARB catalog (`workshopIntakeCopyCatalog`).
/// Source lists: `lib/l10n/fragments/workshop_intake.{en,ar,ur}.json`.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class WorkshopIntakeCopy {
  factory WorkshopIntakeCopy.of(BuildContext context) =>
      WorkshopIntakeCopy.parse(
        AppLocalizations.of(context).workshopIntakeCopyCatalog,
      );

  factory WorkshopIntakeCopy.parse(String catalog) =>
      WorkshopIntakeCopy._(<String, String>{
        for (final String entry in catalog.split('~'))
          if (entry.indexOf('=') > 0)
            entry.substring(0, entry.indexOf('=')):
                entry.substring(entry.indexOf('=') + 1),
      });

  WorkshopIntakeCopy._(this.values);

  final Map<String, String> values;

  String call(String key) => values[key] ?? key;

  String waiting(int n) => n == 1
      ? call('waitingBannerOne')
      : call('waitingBanner').replaceAll('%n%', '$n');

  String enteredBy(String name) => call('enteredBy').replaceAll('%name%', name);

  String workType(String v) => values['wt_$v'] ?? v;

  String priority(String v) => values['pr_$v'] ?? v;

  String source(String v) => values['src_$v'] ?? v;
}
