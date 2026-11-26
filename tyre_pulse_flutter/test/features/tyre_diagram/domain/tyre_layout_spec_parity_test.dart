// Pins the generated Dart copy of the shared tyre map to the JSON the web app
// reads (docs/document-specs/tyre-layouts.json). If this fails, the JSON was
// changed without regenerating: run `node scripts/gen-tyre-layout-spec.mjs`.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_layout_spec.g.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_matcher.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

Map<String, Object?> _loadJson(String name) {
  File f = File('../docs/document-specs/$name');
  if (!f.existsSync()) f = File('docs/document-specs/$name');
  return jsonDecode(f.readAsStringSync()) as Map<String, Object?>;
}

Map<String, Object?> _loadSpec() => _loadJson('tyre-layouts.json');

void main() {
  final Map<String, Object?> spec = _loadSpec();
  final Map<String, Object?> cases = _loadJson('tyre-layout-cases.json');

  // The SAME cases src/test/tyreLayoutSpec.test.js resolves on the web.
  group('web and phone resolve the shared cases alike', () {
    for (final Object? c in cases['resolve']! as List<Object?>) {
      final List<Object?> row = c! as List<Object?>;
      final String type = row[0]! as String;
      final String asset = row[1]! as String;
      final String? key = row[2] as String?;
      final int count = row[3]! as int;
      test('"$type" / "$asset"', () {
        if (count == 0) {
          expect(isTyrelessEquipment(type), isTrue);
          expect(diagramPositions(type, asset), isEmpty);
        } else if (count == -1) {
          expect(resolveVehicleTypeStrict(type, asset), isNull);
        } else {
          expect(resolveVehicleTypeStrict(type, asset), key);
          expect(diagramPositions(type, asset), hasLength(count));
        }
      });
    }
    test('pump record spellings', () {
      final Map<String, Object?> pump =
          cases['pumpPositions']! as Map<String, Object?>;
      for (final MapEntry<String, Object?> e in pump.entries) {
        expect(
          slotForStoredPosition('Concrete pump', e.key),
          e.value,
          reason: e.key,
        );
      }
    });
    test('condition words', () {
      final Map<String, Object?> words =
          cases['conditions']! as Map<String, Object?>;
      for (final MapEntry<String, Object?> e in words.entries) {
        expect(tyreConditionBand(e.key), e.value, reason: e.key);
      }
    });
    test('condition kinds (the picture each word gets)', () {
      final Map<String, Object?> words =
          cases['kinds']! as Map<String, Object?>;
      for (final MapEntry<String, Object?> e in words.entries) {
        expect(tyreConditionKind(e.key), e.value, reason: e.key);
      }
    });
  });

  group('a denied fault is not a fault', () {
    test('"Good, no damage" is green, never red', () {
      expect(normaliseCondition('Good, no damage'), TyreCondition.good);
      expect(
        tyreConditionStatus(normaliseCondition('Good, no damage')),
        TpStatus.ok,
      );
    });
    test('"not damaged" and "without damage" read as good', () {
      expect(normaliseCondition('not damaged'), TyreCondition.good);
      expect(normaliseCondition('Without any damage'), TyreCondition.good);
      expect(normaliseCondition('Undamaged'), TyreCondition.good);
    });
    test('a real fault beside a denied one still counts', () {
      expect(normaliseCondition('Worn, no damage'), TyreCondition.worn);
      expect(
        normaliseCondition('Damaged, not punctured'),
        TyreCondition.damaged,
      );
      expect(normaliseCondition('Damaged'), TyreCondition.damaged);
    });
  });

  test('generated layouts equal the JSON, slot for slot', () {
    final Map<String, Object?> layouts =
        spec['layouts']! as Map<String, Object?>;
    expect(kTyreDiagramLayouts.keys.toList(), layouts.keys.toList());
    for (final MapEntry<String, Object?> e in layouts.entries) {
      final Map<String, Object?> l = e.value! as Map<String, Object?>;
      final DiagramLayout d = kTyreDiagramLayouts[e.key]!;
      expect(d.viewH, (l['viewH']! as num).toDouble(), reason: e.key);
      final List<Object?> slots = l['slots']! as List<Object?>;
      expect(d.tyres.length, slots.length, reason: e.key);
      for (int i = 0; i < slots.length; i++) {
        final List<Object?> s = slots[i]! as List<Object?>;
        final TyreSlot t = d.tyres[i];
        expect(
          <Object>[t.id, t.x, t.y, t.w, t.h],
          <Object>[
            s[0]! as String,
            for (final Object? n in s.skip(1)) (n! as num).toDouble(),
          ],
          reason: '${e.key} slot $i',
        );
      }
    }
  });

  test('generated rules equal the JSON', () {
    expect(kTyreSpecVersion, spec['version']);
    expect(kTyreSpecTyreless, spec['tyreless']);
    final Map<String, Object?> prefix =
        spec['assetPrefix']! as Map<String, Object?>;
    expect(kTyreSpecAssetPrefixPattern, prefix['pattern']);
    expect(kTyreSpecAssetPrefixMap, prefix['map']);
    final Map<String, Object?> codes =
        spec['positionCodes']! as Map<String, Object?>;
    expect(kTyreSpecCodesBase, codes['base']);
    final List<Object?> overrides = codes['overrides']! as List<Object?>;
    expect(kTyreSpecCodeOverrides.length, overrides.length);
    for (int i = 0; i < overrides.length; i++) {
      final Map<String, Object?> o = overrides[i]! as Map<String, Object?>;
      expect(kTyreSpecCodeOverrides[i].$1, o['match']);
      expect(kTyreSpecCodeOverrides[i].$2, o['scope']);
      expect(kTyreSpecCodeOverrides[i].$3, o['codes']);
    }
    final List<Object?> rules = spec['keywordRules']! as List<Object?>;
    expect(kTyreSpecKeywordRules.length, rules.length);
    for (int i = 0; i < rules.length; i++) {
      final Map<String, Object?> r = rules[i]! as Map<String, Object?>;
      expect(kTyreSpecKeywordRules[i].$1, r['layout']);
      expect(kTyreSpecKeywordRules[i].$2, r['words'] ?? <Object?>[]);
      expect(kTyreSpecKeywordRules[i].$3, r['compact'] ?? <Object?>[]);
    }
    final Map<String, Object?> cond =
        spec['conditions']! as Map<String, Object?>;
    expect(kTyreSpecConditionExact, cond['exact']);
    expect(kTyreSpecConditionPatterns, cond['patterns']);
    expect(kTyreSpecConditionNegation, cond['negation']);
    final List<Object?> kinds = cond['kinds']! as List<Object?>;
    expect(kTyreSpecConditionKinds.length, kinds.length);
    List<List<double>> nums(Object? v) => <List<double>>[
          for (final Object? row in (v as List<Object?>?) ?? <Object?>[])
            <double>[
              for (final Object? n in row! as List<Object?>)
                (n! as num).toDouble(),
            ],
        ];
    for (int i = 0; i < kinds.length; i++) {
      final Map<String, Object?> k = kinds[i]! as Map<String, Object?>;
      final Map<String, Object?> g = k['glyph']! as Map<String, Object?>;
      final (
        String kind,
        String band,
        String label,
        String match,
        List<List<double>> strokes,
        List<List<double>> closed,
        List<List<double>> circles,
        List<List<double>> dots,
      ) = kTyreSpecConditionKinds[i];
      expect(kind, k['kind']);
      expect(band, k['band']);
      expect(label, k['label']);
      expect(match, k['match'] ?? '');
      expect(strokes, nums(g['strokes']), reason: kind);
      expect(closed, nums(g['closed']), reason: kind);
      expect(circles, nums(g['circles']), reason: kind);
      expect(dots, nums(g['dots']), reason: kind);
    }
    final Map<String, Object?> palette = (spec['risk']!
        as Map<String, Object?>)['palette']! as Map<String, Object?>;
    for (final String theme in <String>['light', 'dark']) {
      final Map<String, Object?> p = palette[theme]! as Map<String, Object?>;
      for (final MapEntry<String, Object?> b in p.entries) {
        final int argb =
            int.parse('FF${(b.value! as String).substring(1)}', radix: 16);
        expect(
          kTyreSpecPalette[theme]![b.key],
          argb,
          reason: '$theme ${b.key}',
        );
      }
    }
  });

  group('the shared rules, as the web reads them', () {
    test('a concrete pump has at most 14 tyres', () {
      expect(diagramPositions('PUMPS', 'MP093'), hasLength(14));
      expect(diagramPositions('CONCRETE PUMP'), hasLength(14));
      expect(diagramPositions('LINE PUMP'), hasLength(12));
      expect(diagramPositions('STATIONARY PUMP'), isEmpty);
      expect(diagramPositions('PLACING BOOM'), isEmpty);
    });

    test('asset prefixes include CP, BH, LP, MB and a hyphen', () {
      expect(resolveVehicleType('', 'CP014'), 'Concrete pump');
      expect(resolveVehicleType('', 'BH-037'), 'Bus');
      expect(resolveVehicleType('', 'PL-090'), 'Pickup');
      expect(resolveVehicleType('', 'LP001'), 'Line pump');
      expect(resolveVehicleType('', 'MB002'), 'Bus');
      expect(resolveVehicleType('PLACING BOOM'), 'Pickup');
    });

    test('Triton and Xenon are pickups', () {
      expect(resolveVehicleType('MITSUBISHI TRITON'), 'Pickup');
      expect(resolveVehicleType('TATA XENON'), 'Pickup');
    });

    test('pump records land on their wheel under every live spelling', () {
      // Dominant set, the R1-O variant and the legacy 12-code set.
      const Map<String, String> want = <String, String>{
        'LHF1': 'F1L',
        'RHF2': 'F2R',
        'LHR1-I': 'F3L',
        'RHR1-O': 'F3R',
        'LHRCI': 'R1Li',
        'RHRCO': 'R1Ro',
        'LHRRO': 'R2Lo',
        'RHRRI': 'R2Ri',
        'LHCO': 'R1Lo',
        'RHCI': 'R1Ri',
        'LHRO': 'R2Lo',
        'RHRI': 'R2Ri',
      };
      for (final MapEntry<String, String> e in want.entries) {
        expect(
          slotForStoredPosition('Concrete pump', e.key),
          e.value,
          reason: e.key,
        );
      }
      // One record set per machine (a wheel is matched once): the legacy
      // 12-code set lands on the same wheels as the dominant set.
      const List<String> legacy = <String>[
        'LHF1', 'RHF1', 'LHF2', 'RHF2', 'LHCO', 'LHCI', 'RHCI', 'RHCO', //
        'LHRO', 'LHRI', 'RHRI', 'RHRO',
      ];
      final List<MatchedTyreSlot> m = matchPositionsToLayout(
        kTyreDiagramLayouts['Concrete pump']!,
        legacy,
      );
      expect(
        <String>[for (final MatchedTyreSlot s in m) s.id],
        <String>[
          'F1L', 'F1R', 'F2L', 'F2R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', //
          'R2Lo', 'R2Li', 'R2Ri', 'R2Ro',
        ],
      );
    });

    test('pump wheels are named the way their records are', () {
      expect(legacyPositionCode('Concrete pump', 'F3L'), 'LHR1-I');
      expect(legacyPositionCode('Concrete pump', 'R1Lo'), 'LHRCO');
      expect(legacyPositionCode('Concrete pump', 'R2Ro'), 'RHRRO');
      expect(legacyPositionCode('Tri-mixer', 'R1Lo'), 'LHCO');
      expect(legacyPositionCode('Line pump', 'R1Lo'), 'LHR1-O');
      expect(
        legacyPositionCode('Concrete pump', 'R1Lo', erpScope: true),
        'LHR1-O',
      );
    });

    test('condition colours: Flat is red, an unknown word is No data', () {
      expect(
        tyreConditionStatus(normaliseCondition('Flat')),
        TpStatus.critical,
      );
      expect(
        tyreConditionStatus(normaliseCondition('Burst')),
        TpStatus.critical,
      );
      expect(tyreConditionStatus(normaliseCondition('Worn')), TpStatus.warning);
      expect(tyreConditionStatus(normaliseCondition('Good')), TpStatus.ok);
      expect(normaliseCondition('nonsense'), isNull);
      expect(
        tyreConditionStatus(normaliseCondition('nonsense')),
        TpStatus.unknown,
      );
    });
  });
}
