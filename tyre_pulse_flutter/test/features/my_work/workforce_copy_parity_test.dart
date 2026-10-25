/// The company-assignment lane reads its copy from `tasksCopyCatalog`
/// (`key=value` pairs joined with `~`), so a missing key in one language
/// silently renders the raw key. The generic ARB parity test only sees the
/// whole catalog string; this pins the workforce (`wf`) entries per language.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

Map<String, String> _catalog(String language) {
  File? file;
  for (final String root in <String>['lib', 'tyre_pulse_flutter/lib']) {
    final File candidate = File('$root/l10n/app_$language.arb');
    if (candidate.existsSync()) file = candidate;
  }
  if (file == null) fail('app_$language.arb not found');
  final Map<String, dynamic> arb =
      jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  final String raw = arb['tasksCopyCatalog'] as String;
  return <String, String>{
    for (final String entry in raw.split('~'))
      if (entry.indexOf('=') > 0)
        entry.substring(0, entry.indexOf('=')):
            entry.substring(entry.indexOf('=') + 1),
  };
}

/// Every key the panel reads. Status and priority labels are looked up
/// dynamically, so all database values are listed here.
const List<String> _required = <String>[
  'retry',
  'wfTitle',
  'wfLoadError',
  'wfEmpty',
  'wfOffline',
  'wfSiteUnspecified',
  'wfAcknowledge',
  'wfStart',
  'wfSubmit',
  'wfRefresh',
  'wfRejected',
  'wfConflict',
  'wfDenied',
  'wfNetwork',
  'wfS_assigned',
  'wfS_acknowledged',
  'wfS_in_progress',
  'wfS_blocked',
  'wfS_submitted',
  'wfS_verified',
  'wfS_cancelled',
  'wfP_low',
  'wfP_normal',
  'wfP_high',
  'wfP_critical',
];

void main() {
  for (final String language in <String>['en', 'ar', 'ur']) {
    test('$language has every workforce string, non-empty', () {
      final Map<String, String> catalog = _catalog(language);
      for (final String key in _required) {
        expect(catalog[key], isNotNull, reason: '$language is missing $key');
        expect(catalog[key]!.trim(), isNotEmpty, reason: '$language $key');
      }
    });
  }

  test('Arabic and Urdu are actual translations, not English copies', () {
    final Map<String, String> en = _catalog('en');
    for (final String language in <String>['ar', 'ur']) {
      final Map<String, String> other = _catalog(language);
      final Iterable<String> own =
          _required.where((String k) => k.startsWith('wf'));
      for (final String key in own) {
        expect(other[key], isNot(en[key]), reason: '$language $key');
      }
    }
  });
}
