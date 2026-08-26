/// Pins two things: [escapeLikeLiteral]'s wildcard escaping, and
/// [resolveScanLookup]'s ordering rule - asset before tyre, exact before
/// fuzzy, stop at the first hit - proven against a hand-written
/// [FakeScanLookupSource] rather than a real or mocked [SupabaseClient].
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';

import '../fake_scan_lookup_source.dart';

const AssetLookupRecord _asset = AssetLookupRecord(
  id: 'asset-1',
  assetNo: 'TM514',
  site: 'NHC',
  vehicleType: 'Tr-Mixer',
);

const TyreLookupRecord _tyre = TyreLookupRecord(
  id: 'tyre-1',
  brand: 'Bridgestone',
  size: '315/80R22.5',
  tyrePosition: 'LHF1',
  assetNo: 'TM514',
  site: 'NHC',
);

void main() {
  group('escapeLikeLiteral', () {
    test('escapes a percent sign', () {
      expect(escapeLikeLiteral('50%'), r'50\%');
    });

    test('escapes an underscore', () {
      expect(escapeLikeLiteral('TM_514'), r'TM\_514');
    });

    test('escapes both wildcards, in place, without disturbing anything '
        'else', () {
      expect(escapeLikeLiteral('A%B_C'), r'A\%B\_C');
    });

    test('a code with neither wildcard is returned unchanged', () {
      expect(escapeLikeLiteral('TM514'), 'TM514');
    });

    test('an empty string is returned unchanged', () {
      expect(escapeLikeLiteral(''), '');
    });
  });

  group('resolveScanLookup - empty code', () {
    test('a payload that extracts to nothing returns ScanNoMatch without '
        'calling the source at all', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource();

      final ScanLookupResult result = await resolveScanLookup('   ', fake);

      expect(result, isA<ScanNoMatch>());
      expect(result.code, '');
      expect(fake.calls, isEmpty);
    });
  });

  group('resolveScanLookup - the asset chain stops at the first hit', () {
    test(
      'an exact asset_no match short-circuits the rest of the chain',
      () async {
        final FakeScanLookupSource fake = FakeScanLookupSource()
          ..exactAssetByCode['TM514'] = _asset;

        final ScanLookupResult result = await resolveScanLookup('TM514', fake);

        expect(result, isA<AssetScanMatch>());
        expect((result as AssetScanMatch).asset, _asset);
        expect(fake.calls, <String>['exact:TM514']);
      },
    );

    test('a case-insensitive asset_no match is tried only after an exact '
        'miss, and also short-circuits', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..assetByNumberIgnoringCase['tm514'] = _asset;

      final ScanLookupResult result = await resolveScanLookup('tm514', fake);

      expect(result, isA<AssetScanMatch>());
      expect(fake.calls, <String>['exact:tm514', 'numberIgnoringCase:tm514']);
    });

    test('a fleet_number match is tried only after both asset_no steps '
        'miss, and the tyre step is never reached', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..assetByFleetNumberIgnoringCase['F900'] = _asset;

      final ScanLookupResult result = await resolveScanLookup('F900', fake);

      expect(result, isA<AssetScanMatch>());
      expect(fake.calls, <String>[
        'exact:F900',
        'numberIgnoringCase:F900',
        'fleetNumberIgnoringCase:F900',
      ]);
    });
  });

  group('resolveScanLookup - tyre is tried only once every asset step '
      'misses', () {
    test(
      'a tyre match is returned only after all three asset steps miss',
      () async {
        final FakeScanLookupSource fake = FakeScanLookupSource()
          ..tyreBySerial['EP0604207'] = _tyre;

        final ScanLookupResult result = await resolveScanLookup(
          'EP0604207',
          fake,
        );

        expect(result, isA<TyreScanMatch>());
        expect((result as TyreScanMatch).tyre, _tyre);
        expect(fake.calls, <String>[
          'exact:EP0604207',
          'numberIgnoringCase:EP0604207',
          'fleetNumberIgnoringCase:EP0604207',
          'tyreSerial:EP0604207',
        ]);
      },
    );

    test('when nothing matches at all, every step ran once and the result '
        'is ScanNoMatch carrying the extracted code', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource();

      final ScanLookupResult result = await resolveScanLookup(
        ' NOTHING-HERE ',
        fake,
      );

      expect(result, isA<ScanNoMatch>());
      expect(result.code, 'NOTHING-HERE');
      expect(result.rawInput, ' NOTHING-HERE ');
      expect(fake.calls, <String>[
        'exact:NOTHING-HERE',
        'numberIgnoringCase:NOTHING-HERE',
        'fleetNumberIgnoringCase:NOTHING-HERE',
        'tyreSerial:NOTHING-HERE',
      ]);
    });
  });

  group('resolveScanLookup - the reported code', () {
    test('an asset match reports the CANONICAL asset_no, not the scanned '
        'code, when they differ', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..assetByNumberIgnoringCase['tm514'] = _asset;

      final ScanLookupResult result = await resolveScanLookup('tm514', fake);

      expect(result.code, 'TM514');
      expect(result.rawInput, 'tm514');
    });

    test('extraction runs before the source is asked anything, so a JSON '
        'payload reaches the fake already unwrapped', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..exactAssetByCode['TM99'] = const AssetLookupRecord(
          id: 'asset-2',
          assetNo: 'TM99',
        );

      final ScanLookupResult result = await resolveScanLookup(
        '{"asset_no":"TM99"}',
        fake,
      );

      expect(result, isA<AssetScanMatch>());
      expect(fake.calls, <String>['exact:TM99']);
      expect(result.rawInput, '{"asset_no":"TM99"}');
    });
  });

  group('resolveScanLookup - never throws', () {
    test('a plain exception from the source becomes ScanLookupFailed, not '
        'a thrown exception', () async {
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..errorToThrow = Exception('offline');

      final ScanLookupResult result = await resolveScanLookup('TM514', fake);

      expect(result, isA<ScanLookupFailed>());
      final ScanLookupFailed failed = result as ScanLookupFailed;
      expect(failed.error.kind, AppErrorKind.unknown);
      expect(failed.error.isRetryable, isTrue);
      expect(failed.code, 'TM514');
    });

    test('an AppError thrown by the source is preserved as-is, not '
        're-wrapped into a generic one', () async {
      const AppError original = AppError.authorization(
        message: 'You do not have permission to do this.',
        technical: 'test-injected refusal',
      );
      final FakeScanLookupSource fake = FakeScanLookupSource()
        ..errorToThrow = original;

      final ScanLookupResult result = await resolveScanLookup('TM514', fake);

      expect(result, isA<ScanLookupFailed>());
      expect((result as ScanLookupFailed).error, same(original));
    });
  });
}
