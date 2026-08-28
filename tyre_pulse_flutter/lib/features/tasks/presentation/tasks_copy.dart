library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class TasksCopy {
  factory TasksCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).tasksCopyCatalog;
    return TasksCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  TasksCopy._(this._values);

  final Map<String, String> _values;

  String call(String key) => _values[key] ?? key;
}
