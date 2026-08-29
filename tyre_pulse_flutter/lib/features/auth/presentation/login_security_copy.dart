library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

final class LoginSecurityCopy {
  LoginSecurityCopy._(this._values);

  factory LoginSecurityCopy.of(BuildContext context) {
    final String catalog =
        AppLocalizations.of(context).loginSecurityCopyCatalog;
    return LoginSecurityCopy._(<String, String>{
      for (final String entry in catalog.split('~'))
        if (entry.indexOf('=') case final int separator when separator > 0)
          entry.substring(0, separator): entry.substring(separator + 1),
    });
  }

  final Map<String, String> _values;

  String _read(String key) => _values[key] ?? key;

  String secureWorkspace(String country) =>
      _read('secure').replaceAll('%country%', country);

  String get forgot => _read('forgot');
  String get access => _read('access');
  String get or => _read('or');
  String get biometric => _read('biometric');
  String get authorized => _read('authorized');
  String get audited => _read('audited');
  String version(String value) =>
      _read('version').replaceAll('%version%', value);
  String get biometricReason => _read('biometricReason');
  String get biometricUnavailable => _read('biometricUnavailable');
  String get biometricLocked => _read('biometricLocked');
  String get biometricFailed => _read('biometricFailed');
  String get credentialsRequired => _read('credentialsRequired');
  String get helpTitle => _read('helpTitle');
  String get forgotHelp => _read('forgotHelp');
  String get accessHelp => _read('accessHelp');
}
