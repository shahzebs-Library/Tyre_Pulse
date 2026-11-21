// Physical inventory capture screen: existing stores are picked (never typed
// or created), a TP:LOC label selects the bin, the big quantity stepper fills
// the quantity and Save and next sits in the bottom bar.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/physical_inventory_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/physical_capture.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/physical_inventory_screen.dart';

const InventoryPlace _storeA = InventoryPlace(
  id: 'wh-a',
  site: 'DEMO YARD',
  code: 'DEMO-WH-A',
  name: 'Store A',
  locationType: 'warehouse',
  country: 'KSA',
);
const InventoryPlace _storeB = InventoryPlace(
  id: 'wh-b',
  site: 'DEMO YARD',
  code: 'DEMO-WH-B',
  locationType: 'warehouse',
  country: 'KSA',
);

final class _Repo implements PhysicalInventoryRepository {
  String? startedLocation;

  @override
  Future<List<InventoryPlace>> stores() async =>
      const <InventoryPlace>[_storeA, _storeB];

  @override
  Future<InventoryPlace?> placeById(String id) async => id == 'bin-7'
      ? const InventoryPlace(
          id: 'bin-7',
          site: 'DEMO YARD',
          code: 'BIN-7',
          locationType: 'bin',
          country: 'KSA',
        )
      : null;

  @override
  Future<PhysicalSession> startSession({
    required String idempotencyKey,
    required String country,
    required String site,
    String? locationId,
  }) async {
    startedLocation = locationId;
    return PhysicalSession(
      id: 's1',
      reference: 'PI-1',
      site: site,
      status: 'open',
      country: country,
      locationId: locationId,
    );
  }

  @override
  Future<List<PhysicalSession>> openSessions() async =>
      const <PhysicalSession>[];

  @override
  Future<List<MaterialPick>> search(String query) async =>
      const <MaterialPick>[];

  @override
  Future<Map<String, Object?>> capture(Map<String, Object?> payload) =>
      throw UnimplementedError();

  @override
  Future<void> upload(String path, Uint8List bytes) =>
      throw UnimplementedError();

  @override
  Future<void> attachPhoto(Map<String, Object?> payload) =>
      throw UnimplementedError();
}

void main() {
  testWidgets('stores are picked from the list; a bin label selects the bin',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          workspaceContextProvider.overrideWithValue(null as WorkspaceContext?),
          physicalInventoryRepositoryProvider.overrideWithValue(repo),
          openPhysicalSessionsProvider
              .overrideWith((Ref ref) async => const <PhysicalSession>[]),
        ],
        child: const MaterialApp(
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: PhysicalInventoryScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // No free-text store field: existing stores only, and Start waits for one.
    expect(find.byKey(const Key('pi.store')), findsNothing);
    expect(find.byKey(const Key('pi.store.wh-a')), findsOneWidget);
    expect(find.byKey(const Key('pi.store.wh-b')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('pi.store.wh-a'))).height,
      greaterThanOrEqualTo(48),
    );

    await tester.tap(find.byKey(const Key('pi.store.wh-a')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('pi.start')));
    await tester.pumpAndSettle();
    expect(repo.startedLocation, 'wh-a');

    // Save and next is in the bottom bar, at least 48dp tall.
    final Finder save = find.byKey(const Key('pi.save'));
    expect(save, findsOneWidget);
    expect(tester.getSize(save).height, greaterThanOrEqualTo(48));
    expect(
      tester.getBottomLeft(save).dy,
      greaterThan(
        tester.view.physicalSize.height / tester.view.devicePixelRatio * 0.8,
      ),
    );

    // The big stepper fills the quantity.
    await tester.tap(find.byKey(const Key('inventory.qty.plus10')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('inventory.qty.plus1')));
    await tester.pump();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('pi.qty')))
          .controller!
          .text,
      '11',
    );

    // A TP:LOC label selects the bin.
    await tester.enterText(
      find.byKey(const Key('inventory.scan.field')),
      'TP:LOC:bin-7',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('pi.bin')), findsOneWidget);
    expect(find.textContaining('BIN-7'), findsOneWidget);
  });
}
