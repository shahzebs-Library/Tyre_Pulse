library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class CalendarCopy {
  factory CalendarCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).calendarCopyCatalog;
    return CalendarCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  CalendarCopy._(this.values);
  final Map<String, String> values;
  String call(String key) => values[key] ?? key;
}
