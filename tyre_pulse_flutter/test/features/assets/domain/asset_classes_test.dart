/// Parity coverage for `lib/features/assets/domain/asset_classes.dart`
/// against `mobile/lib/assetClasses.ts`.
///
/// This file did not have a test before this change - the RN inventory
/// records "Feature areas with NO dedicated test: ... assets and scanning" -
/// so there is no existing TypeScript test to port. These cases are derived
/// directly from reading both source files side by side; each one names
/// which behaviour it is pinning.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/asset_classes.dart';

void main() {
  group('tyreAssetClasses', () {
    test(
        'matches TYRE_ASSET_CLASSES in mobile/lib/assetClasses.ts exactly, '
        'in order', () {
      // Order matters: it is the priority classChips sorts by.
      expect(tyreAssetClasses, <String>[
        'TM',
        'MP',
        'PL',
        'WL',
        'BH',
        'SL',
        'LP',
        'MB',
      ]);
    });
  });

  group('assetClassOf', () {
    test('extracts the leading letters, uppercased', () {
      expect(assetClassOf('TM514'), 'TM');
      expect(assetClassOf('tm514'), 'TM');
      expect(assetClassOf('Mp093'), 'MP');
    });

    test('trims surrounding whitespace before matching', () {
      expect(assetClassOf('  TM514  '), 'TM');
      expect(assetClassOf('\tGN103\n'), 'GN');
    });

    test('returns null for null, empty or whitespace-only input', () {
      expect(assetClassOf(null), isNull);
      expect(assetClassOf(''), isNull);
      expect(assetClassOf('   '), isNull);
    });

    test(
        'returns null when the code does not start with a letter - never '
        'invents a class for a code the register does not explain', () {
      expect(assetClassOf('514TM'), isNull);
      expect(assetClassOf('123'), isNull);
      expect(assetClassOf('-TM514'), isNull);
    });

    test('a single-letter or long prefix is still extracted in full', () {
      expect(assetClassOf('X514'), 'X');
      expect(assetClassOf('ABCDE123'), 'ABCDE');
    });
  });

  group('isTyreAsset', () {
    test('true for every class in tyreAssetClasses', () {
      for (final String cls in tyreAssetClasses) {
        expect(isTyreAsset('${cls}001'), isTrue, reason: cls);
      }
    });

    test('false for a real class outside the tyre-carrying set', () {
      expect(isTyreAsset('GN103'), isFalse);
      expect(isTyreAsset('BP041'), isFalse);
      expect(isTyreAsset('IP001'), isFalse);
    });

    test(
        'false for a code with no recognisable class at all - distinct '
        'from "recognised but not a tyre class"', () {
      expect(isTyreAsset('123'), isFalse);
      expect(isTyreAsset(null), isFalse);
      expect(isTyreAsset(''), isFalse);
    });

    test('is case-insensitive on the input', () {
      expect(isTyreAsset('tm514'), isTrue);
    });
  });

  group('classChips', () {
    test(
        'counts one chip per class present, tyre-carrying first in '
        'priority order', () {
      final List<AssetClassChip> chips = classChips(<String?>[
        'GN101',
        'TM514',
        'TM515',
        'MP093',
        'GN102',
        'BH001',
      ]);

      // Tyre classes first, in tyreAssetClasses order (TM before MP before
      // BH, regardless of count), then non-tyre classes.
      final List<String> order =
          chips.map((AssetClassChip c) => c.assetClass).toList();
      expect(order, <String>['TM', 'MP', 'BH', 'GN']);

      final AssetClassChip tm = chips.firstWhere(
        (AssetClassChip c) => c.assetClass == 'TM',
      );
      expect(tm.count, 2);
      expect(tm.isTyreClass, isTrue);

      final AssetClassChip gn = chips.firstWhere(
        (AssetClassChip c) => c.assetClass == 'GN',
      );
      expect(gn.count, 2);
      expect(gn.isTyreClass, isFalse);
    });

    test('non-tyre classes with a tied count are sorted alphabetically', () {
      final List<AssetClassChip> chips = classChips(<String?>[
        'IP001',
        'BP001',
        'GN001',
      ]);
      expect(chips.map((AssetClassChip c) => c.assetClass).toList(), <String>[
        'BP',
        'GN',
        'IP',
      ]);
    });

    test(
        'non-tyre classes with a higher count sort before a lower one, '
        'ahead of the alphabetical tiebreak', () {
      final List<AssetClassChip> chips = classChips(<String?>[
        'IP001',
        'GN001',
        'GN002',
        'GN003',
      ]);
      expect(chips.map((AssetClassChip c) => c.assetClass).toList(), <String>[
        'GN',
        'IP',
      ]);
    });

    test('a row with no recognisable class contributes to no chip at all', () {
      final List<AssetClassChip> chips = classChips(<String?>[
        '123',
        null,
        '',
        'TM514',
      ]);
      expect(chips.length, 1);
      expect(chips.single.assetClass, 'TM');
      expect(chips.single.count, 1);
    });

    test('an empty input produces no chips', () {
      expect(classChips(const <String?>[]), isEmpty);
    });
  });

  group('AssetClassChip value equality', () {
    test('two chips with the same fields are equal', () {
      const AssetClassChip a = AssetClassChip(
        assetClass: 'TM',
        count: 3,
        isTyreClass: true,
      );
      const AssetClassChip b = AssetClassChip(
        assetClass: 'TM',
        count: 3,
        isTyreClass: true,
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a different count is a different chip', () {
      const AssetClassChip a = AssetClassChip(
        assetClass: 'TM',
        count: 3,
        isTyreClass: true,
      );
      const AssetClassChip b = AssetClassChip(
        assetClass: 'TM',
        count: 4,
        isTyreClass: true,
      );
      expect(a, isNot(b));
    });
  });
}
