import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/selected_vehicle_card.dart';

void main() {
  testWidgets('contains verified vehicle artwork without cropping',
      (WidgetTester tester) async {
    const VehicleAsset asset = VehicleAsset(
      id: 'ashok-bus',
      assetNo: 'BUS-207',
      make: 'Ashok Leyland',
      vehicleType: 'BUS',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SelectedVehicleCard(
            asset: asset,
            changeLabel: 'Rescan',
            unavailableLabel: 'Unknown asset',
            onChange: () {},
          ),
        ),
      ),
    );

    final Image image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.contain);
    expect(
      (image.image as AssetImage).assetName,
      'assets/vehicle_photos/ashok_bus_fleet.jpeg',
    );
  });

  testWidgets('uses the class icon when the brand has no matching artwork',
      (WidgetTester tester) async {
    const VehicleAsset asset = VehicleAsset(
      id: 'foton-bus',
      assetNo: 'BUS-900',
      make: 'FOTON',
      vehicleType: 'BUS',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SelectedVehicleCard(
            asset: asset,
            changeLabel: 'Rescan',
            unavailableLabel: 'Unknown asset',
            onChange: () {},
          ),
        ),
      ),
    );

    expect(find.byType(Image), findsNothing);
    expect(find.byIcon(Icons.directions_bus_outlined), findsOneWidget);
  });
}
