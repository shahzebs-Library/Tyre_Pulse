library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class NotificationsCopy {
  factory NotificationsCopy.of(BuildContext context) {
    final String catalog =
        AppLocalizations.of(context).notificationInboxCopyCatalog;
    return NotificationsCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }

  NotificationsCopy._(this._values);

  final Map<String, String> _values;

  String call(String key, {Object? count}) {
    final String value = _values[key] ?? key;
    return count == null ? value : value.replaceAll('%count%', '$count');
  }
}
