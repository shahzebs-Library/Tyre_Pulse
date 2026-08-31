import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/vehicle_multiview_board.dart';

Future<void> _pump(
  WidgetTester tester, {
  required VehicleAsset asset,
  TextDirection direction = TextDirection.ltr,
}) {
  return tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      home: Directionality(
        textDirection: direction,
        child: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: VehicleMultiViewBoard(
              asset: asset,
              title: 'Vehicle views',
              hint: 'Front · Rear · Top · Left · Right',
              zoomLabel: 'Tap to zoom',
              closeLabel: 'Close',
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets(
    'reference constructor resolves submitted inspection fields without a '
    'fabricated fleet row',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: TpTheme.light,
          home: const Scaffold(
            body: SingleChildScrollView(
              padding: EdgeInsets.all(16),
              child: VehicleMultiViewBoard.reference(
                assetNo: 'MP083',
                vehicleType: 'Concrete pump 5 axle',
                make: 'SANY',
                model: '5 axle',
                title: 'Vehicle views',
                hint: 'Front · Rear · Top · Left · Right',
                zoomLabel: 'Tap to zoom',
                closeLabel: 'Close',
              ),
            ),
          ),
        ),
      );

      final Image image = tester.widget<Image>(
        find.byKey(VehicleMultiViewBoardKeys.image),
      );
      expect(
        (image.image as AssetImage).assetName,
        'assets/vehicle_multiview/'
        'sany_concrete_pump_5axle_five_view_v1.png',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('renders the correct generated board for the fleet class', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      asset: const VehicleAsset(
        id: 'pump',
        vehicleType: 'SANY Concrete Pump 5 axle',
      ),
    );

    final Image image = tester.widget<Image>(
      find.byKey(VehicleMultiViewBoardKeys.image),
    );
    expect(
      (image.image as AssetImage).assetName,
      'assets/vehicle_multiview/sany_concrete_pump_5axle_five_view_v1.png',
    );
  });

  testWidgets('tap opens a pinch-zoom view and Close dismisses it', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      asset: const VehicleAsset(
        id: 'hiace',
        vehicleType: 'Toyota Hiace',
      ),
    );

    await tester.tap(find.byKey(VehicleMultiViewBoardKeys.board));
    await tester.pumpAndSettle();
    expect(find.byKey(VehicleMultiViewBoardKeys.zoomDialog), findsOneWidget);
    expect(find.byKey(VehicleMultiViewBoardKeys.zoomImage), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsOneWidget);

    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.byKey(VehicleMultiViewBoardKeys.zoomDialog), findsNothing);
  });

  testWidgets('RTL layout remains usable without overflow', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(393, 852);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pump(
      tester,
      direction: TextDirection.rtl,
      asset: const VehicleAsset(
        id: 'tata',
        vehicleType: 'Tata 32 seater bus',
      ),
    );
    expect(find.byKey(VehicleMultiViewBoardKeys.board), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unknown road equipment receives no misleading board', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      asset: const VehicleAsset(
        id: 'unknown',
        vehicleType: 'Unregistered crane carrier',
      ),
    );
    expect(find.byKey(VehicleMultiViewBoardKeys.board), findsNothing);
  });
}
