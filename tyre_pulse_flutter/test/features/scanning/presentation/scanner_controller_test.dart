/// Pins [ScannerController]'s async lifecycle - idle, resolving, resolved -
/// against a hand-written [FakeScanLookupSource]. No widget tree, no real
/// [SupabaseClient]: [scanLookupRepositoryProvider] is typed against the
/// [ScanLookupSource] interface precisely so this is possible - see that
/// provider's own doc comment.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_controller.dart';

import '../fake_scan_lookup_source.dart';

void main() {
  late FakeScanLookupSource fake;
  late ProviderContainer container;

  setUp(() {
    fake = FakeScanLookupSource();
    container = ProviderContainer(
      overrides: <Override>[
        scanLookupRepositoryProvider.overrideWithValue(fake),
      ],
    );
  });

  tearDown(container.dispose);

  test('starts idle', () {
    expect(container.read(scannerControllerProvider), isA<ScannerIdle>());
  });

  test('submit moves synchronously to resolving, then settles on resolved '
      'once the source answers', () async {
    fake.exactAssetByCode['TM514'] = const AssetLookupRecord(
      id: 'a1',
      assetNo: 'TM514',
    );

    final Future<void> pending = container
        .read(scannerControllerProvider.notifier)
        .submit('TM514');

    // The state assignment at the top of `submit` runs synchronously, before
    // the first `await` inside it - this checks that promise without
    // waiting for the future at all.
    expect(container.read(scannerControllerProvider), isA<ScannerResolving>());

    await pending;

    final ScannerState finalState = container.read(scannerControllerProvider);
    expect(finalState, isA<ScannerResolved>());
    final ScanLookupResult result = (finalState as ScannerResolved).result;
    expect(result, isA<AssetScanMatch>());
    expect((result as AssetScanMatch).asset.assetNo, 'TM514');
  });

  test('submit reads the source through the injected fake, not a real '
      'client', () async {
    await container.read(scannerControllerProvider.notifier).submit('anything');

    expect(fake.calls, isNotEmpty);
  });

  test('a source failure resolves to ScannerResolved carrying '
      'ScanLookupFailed - submit itself never throws', () async {
    fake.errorToThrow = Exception('offline');

    await container.read(scannerControllerProvider.notifier).submit('TM514');

    final ScannerState finalState = container.read(scannerControllerProvider);
    expect(finalState, isA<ScannerResolved>());
    expect((finalState as ScannerResolved).result, isA<ScanLookupFailed>());
  });

  test('reset returns to idle after a result was shown', () async {
    await container
        .read(scannerControllerProvider.notifier)
        .submit('nothing-matches-this');
    expect(container.read(scannerControllerProvider), isA<ScannerResolved>());

    container.read(scannerControllerProvider.notifier).reset();

    expect(container.read(scannerControllerProvider), isA<ScannerIdle>());
  });

  test('a second submit after a result replaces it, rather than requiring '
      'a reset first', () async {
    fake.exactAssetByCode['A1'] = const AssetLookupRecord(
      id: 'a1',
      assetNo: 'A1',
    );
    fake.exactAssetByCode['A2'] = const AssetLookupRecord(
      id: 'a2',
      assetNo: 'A2',
    );

    final ScannerController controller = container.read(
      scannerControllerProvider.notifier,
    );

    await controller.submit('A1');
    final ScanLookupResult first =
        (container.read(scannerControllerProvider) as ScannerResolved).result;
    expect((first as AssetScanMatch).asset.assetNo, 'A1');

    await controller.submit('A2');
    final ScanLookupResult second =
        (container.read(scannerControllerProvider) as ScannerResolved).result;
    expect((second as AssetScanMatch).asset.assetNo, 'A2');
  });
}
