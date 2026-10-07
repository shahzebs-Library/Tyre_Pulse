import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_vocab.dart';

/// The drift guard for the Workshop Status vocabularies.
///
/// Reads `src/lib/workshopStatus/vocab.js` as TEXT (importing it would compare
/// a value to itself) and checks the Dart lists match it exactly, in order.
/// The server refuses any value outside these lists, so a drift here would be
/// a dropdown whose choices the server rejects.
///
/// Fails, never skips, when the reference file cannot be found: a guard that
/// quietly disappears is worse than none.
void main() {
  late final String source;

  setUpAll(() {
    source = _locateVocab().readAsStringSync();
  });

  test('CURRENT_STAGES matches, in order', () {
    expect(kWorkshopCurrentStages, _parseArray(source, 'CURRENT_STAGES'));
  });

  test('SELECTABLE_STAGES drops only the released stage', () {
    final List<String> stages = _parseArray(source, 'CURRENT_STAGES');
    expect(source, contains("s !== '$kWorkshopReleasedStage'"));
    expect(
      kWorkshopSelectableStages,
      stages.where((String s) => s != kWorkshopReleasedStage).toList(),
    );
  });

  test('DELAY_REASONS matches, in order', () {
    expect(kWorkshopDelayReasons, _parseArray(source, 'DELAY_REASONS'));
  });

  test('PARTS_STATUSES matches, in order', () {
    expect(kWorkshopPartsStatuses, _parseArray(source, 'PARTS_STATUSES'));
  });

  test('the Other delay reason matches DELAY_REASON_OTHER', () {
    expect(
      source,
      contains(
        "export const DELAY_REASON_OTHER = '$kWorkshopDelayReasonOther'",
      ),
    );
    expect(workshopNeedsDetailedReason('Other'), isTrue);
    expect(workshopNeedsDetailedReason(' Other '), isTrue);
    expect(workshopNeedsDetailedReason('MR Pending'), isFalse);
    expect(workshopNeedsDetailedReason(null), isFalse);
  });

  test('the parse is not vacuous', () {
    expect(_parseArray(source, 'CURRENT_STAGES').length, greaterThan(10));
    expect(_parseArray(source, 'DELAY_REASONS').length, greaterThan(20));
    expect(_parseArray(source, 'PARTS_STATUSES').length, greaterThan(10));
  });

  test('vocabKey matches the web helper', () {
    expect(workshopVocabKey('QC / Inspection'), 'qc_inspection');
    expect(
      workshopVocabKey('Waiting for Vehicle Recovery / Towing'),
      'waiting_for_vehicle_recovery_towing',
    );
  });

  group('every pickable value has a display label in en, ar and ur', () {
    for (final String lang in <String>['en', 'ar', 'ur']) {
      test(lang, () {
        final Map<String, dynamic> arb = jsonDecode(
          _locateArb('app_$lang.arb').readAsStringSync(),
        ) as Map<String, dynamic>;
        final String catalog = arb['workshopStatusVocabCatalog'] as String;
        final Map<String, String> labels = <String, String>{
          for (final String e in catalog.split('~'))
            if (e.indexOf('=') > 0)
              e.substring(0, e.indexOf('=')): e.substring(e.indexOf('=') + 1),
        };
        for (final String v in <String>[
          ...kWorkshopSelectableStages,
          ...kWorkshopDelayReasons,
          ...kWorkshopPartsStatuses,
        ]) {
          expect(
            labels[workshopVocabKey(v)],
            isNotNull,
            reason: '$lang has no label for "$v"',
          );
          expect(labels[workshopVocabKey(v)]!.trim(), isNotEmpty);
        }
      });
    }
  });
}

List<String> _parseArray(String source, String name) {
  final RegExpMatch? m = RegExp(
    'export const $name = Object\\.freeze\\(\\[(.*?)\\]',
    dotAll: true,
  ).firstMatch(source);
  if (m == null) fail('$name not found in vocab.js');
  return RegExp("'([^']*)'")
      .allMatches(m.group(1)!)
      .map((RegExpMatch x) => x.group(1)!)
      .toList();
}

File _locateVocab() {
  Directory dir = Directory.current;
  for (int i = 0; i < 6; i++) {
    final File f = File(
      '${dir.path}/src/lib/workshopStatus/vocab.js'
          .replaceAll('/', Platform.pathSeparator),
    );
    if (f.existsSync()) return f;
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  fail(
    'Could not find src/lib/workshopStatus/vocab.js by walking up from '
    '${Directory.current.path}. This guard compares the Dart vocabularies '
    'against the web source and cannot run without it.',
  );
}

File _locateArb(String name) {
  for (final String rel in <String>[
    'lib/l10n/$name',
    'tyre_pulse_flutter/lib/l10n/$name',
  ]) {
    final File f = File(rel.replaceAll('/', Platform.pathSeparator));
    if (f.existsSync()) return f;
  }
  fail('Could not find lib/l10n/$name');
}
