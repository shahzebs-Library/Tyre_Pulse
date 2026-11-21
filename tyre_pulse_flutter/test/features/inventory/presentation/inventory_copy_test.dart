import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_copy.dart';

Map<String, String> _catalog(String lang, String key) {
  final Map<String, dynamic> arb = jsonDecode(
    File('lib/l10n/app_$lang.arb').readAsStringSync(),
  ) as Map<String, dynamic>;
  return InventoryCopy.parse(arb[key]! as String).values;
}

/// Every literal copy key the inventory screens ask for.
Set<String> _usedKeys() {
  final RegExp literal = RegExp(r"copy(?:\.count)?\('([A-Za-z_]+)'");
  final Set<String> keys = <String>{};
  for (final FileSystemEntity f
      in Directory('lib/features/inventory').listSync(recursive: true)) {
    if (f is File && f.path.endsWith('.dart')) {
      for (final RegExpMatch m in literal.allMatches(f.readAsStringSync())) {
        keys.add(m.group(1)!);
      }
    }
  }
  return keys;
}

void main() {
  test('en, ar and ur inventory catalogs carry the same keys', () {
    final Set<String> en = _catalog('en', 'inventoryCopyCatalog').keys.toSet();
    expect(en, isNotEmpty);
    expect(_catalog('ar', 'inventoryCopyCatalog').keys.toSet(), en);
    expect(_catalog('ur', 'inventoryCopyCatalog').keys.toSet(), en);
  });

  test('every key the screens use exists in the catalog', () {
    final Set<String> en = _catalog('en', 'inventoryCopyCatalog').keys.toSet();
    // Keys built at runtime (copy(problem), copy('scan_...')) are listed
    // explicitly so a missing one fails here instead of showing a key path.
    final Set<String> dynamicKeys = <String>{
      'draftSaveFailed',
      'enterQty',
      'invalidQty',
      'confirmZeroFirst',
      'photoFailed',
      'needFrom',
      'needTo',
      'sameLocation',
      'needLines',
      'finishUnsent',
      'finishNotOpen',
      'finishOffline',
      'finishDone',
      'finishFailed',
      'scan_locationSelected',
      'scan_serialItemSelected',
      'scan_locationOutOfScope',
      'scan_duplicateSerial',
      'scan_needsLocation',
      for (final String c in <String>[
        'good',
        'damaged',
        'repairable',
        'quarantine',
        'scrap',
      ])
        'condition_$c',
      for (final String s in <String>['draft', 'submitted', 'rejected'])
        'state_$s',
    };
    final Set<String> missing =
        <String>{..._usedKeys(), ...dynamicKeys}.difference(en);
    expect(missing, isEmpty, reason: 'missing copy keys: $missing');
  });

  test('the finish-counting copy exists in every language (catalog pinned)',
      () {
    const List<String> finishKeys = <String>[
      'finishCounting',
      'finishNote',
      'finishUnsent',
      'finishNotOpen',
      'finishOffline',
      'finishConfirmTitle',
      'finishConfirmBody',
      'finishCancel',
      'finishDone',
      'finishFailed',
    ];
    for (final String lang in <String>['en', 'ar', 'ur']) {
      final Map<String, String> c = _catalog(lang, 'inventoryCopyCatalog');
      // Pinned entry count of the packed catalog: 125 + 10 finish keys
      // + submitQueued (background sync).
      expect(c.length, 136, reason: lang);
      expect(c['submitQueued'], contains('%n'), reason: lang);
      expect(
        c['manualSendNote']!.toLowerCase(),
        isNot(contains('later app update')),
        reason: '$lang: background sending is live, not promised for later',
      );
      for (final String k in finishKeys) {
        expect(c[k], isNotNull, reason: '$lang $k');
        expect(c[k]!.trim(), isNotEmpty, reason: '$lang $k');
      }
      expect(c['finishUnsent'], contains('%n'));
    }
  });

  test('placeholders use %n, never braces (braces become ICU args)', () {
    for (final String lang in <String>['en', 'ar', 'ur']) {
      final Map<String, String> c = _catalog(lang, 'inventoryCopyCatalog');
      expect(c.values.any((String v) => v.contains('{')), isFalse);
      expect(c['submitN'], contains('%n'));
    }
    final InventoryCopy copy = InventoryCopy.parse('a=Send %n lines');
    expect(copy.count('a', 3), 'Send 3 lines');
    expect(copy('missing'), 'missing');
    expect(copy.label('status_', 'brand_new'), 'brand_new');
  });

  test('Stock Count carries the new entry-point labels in every language', () {
    for (final String lang in <String>['en', 'ar', 'ur']) {
      final Map<String, dynamic> arb = jsonDecode(
        File('lib/l10n/app_$lang.arb').readAsStringSync(),
      ) as Map<String, dynamic>;
      final String raw = arb['stockCountCopyCatalog']! as String;
      expect(raw, contains('~myCounts='));
      expect(raw, contains('~transfers='));
    }
    // Same packed shape as StockCountCopy reads.
    expect(StockCountCopy, isNotNull);
  });
}
