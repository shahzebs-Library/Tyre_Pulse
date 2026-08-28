library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class ManagementCopy {
  factory ManagementCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).managementCopyCatalog;
    return ManagementCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  ManagementCopy._(this.values);
  final Map<String, String> values;
  String call(String key) => values[key] ?? _humanize(key);
}

String _humanize(String raw) => raw
    .replaceAll('_', ' ')
    .split(' ')
    .map(
      (String word) =>
          word.isEmpty ? word : '${word[0].toUpperCase()}${word.substring(1)}',
    )
    .join(' ');
