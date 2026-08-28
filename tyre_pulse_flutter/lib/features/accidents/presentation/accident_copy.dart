library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// Feature copy parsed from the locale-specific ARB catalog.
///
/// Accident work is intentionally kept in one compact catalog because this
/// module has a dense operational vocabulary. The catalog itself still lives
/// in every shipped ARB (English, Arabic and Urdu), so RTL copy never falls
/// back to a hard-coded presentation string.
final class AccidentCopy {
  factory AccidentCopy.of(BuildContext context) {
    final String catalog = AppLocalizations.of(context).accidentCopyCatalog;
    return AccidentCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') > 0)
          entry.substring(0, entry.indexOf('=')):
              entry.substring(entry.indexOf('=') + 1),
    });
  }
  AccidentCopy._(this._values);

  final Map<String, String> _values;

  String call(String key) => _values[key] ?? key;
}
