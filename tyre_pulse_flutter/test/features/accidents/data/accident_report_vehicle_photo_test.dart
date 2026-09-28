import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_vehicle_photo.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_report_intake_widgets.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

const VehicleAsset _pump = VehicleAsset(
  id: 'pump-1',
  assetNo: 'CP045',
  make: 'SANY',
  vehicleType: 'PUMPS',
);

const VehicleAsset _unknownKind = VehicleAsset(
  id: 'odd-1',
  assetNo: 'ZZ001',
  vehicleType: 'SOMETHING NEW',
);

final class _FakePhotos implements AccidentVehiclePhotoSource {
  _FakePhotos(this.paths);
  final Map<String, String> paths;
  final List<String> signed = <String>[];

  @override
  Future<Map<String, String>> uploadedPhotoPaths() async => paths;

  @override
  Future<String> signedUrl(String path) async {
    signed.add(path);
    return 'https://example.invalid/signed/$path';
  }
}

Future<void> _pumpView(
  WidgetTester tester,
  VehicleAsset asset,
  _FakePhotos photos,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [accidentVehiclePhotoSourceProvider.overrideWithValue(photos)],
      child: MaterialApp(
        theme: TpTheme.light,
        home: Scaffold(
          body: SizedBox(
            width: 120,
            height: 100,
            child: AccidentVehicleImageView(
              asset: asset,
              semanticLabel: asset.assetNo!,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  group('resolveAccidentVehicleImage order', () {
    test('an uploaded photo wins over the class photo', () {
      expect(
        resolveAccidentVehicleImage(
          uploadedUrl: 'https://x/y.jpg',
          classPhotoAsset: 'assets/vehicle_photos/concrete_pump.png',
        ),
        isA<AccidentVehicleUploadedPhoto>(),
      );
    });

    test('no upload falls back to the class photo', () {
      final AccidentVehicleImage image = resolveAccidentVehicleImage(
        uploadedUrl: '  ',
        classPhotoAsset: 'assets/vehicle_photos/concrete_pump.png',
      );
      expect(image, isA<AccidentVehicleClassPhoto>());
      expect(
        (image as AccidentVehicleClassPhoto).assetPath,
        'assets/vehicle_photos/concrete_pump.png',
      );
    });

    test('no upload and no class match is a placeholder, never a vehicle', () {
      expect(
        resolveAccidentVehicleImage(),
        isA<AccidentVehiclePlaceholder>(),
      );
    });
  });

  group('AccidentVehicleImageView', () {
    testWidgets('shows the asset own photo through a signed URL',
        (WidgetTester tester) async {
      final _FakePhotos photos =
          _FakePhotos(<String, String>{'pump-1': 'org/KSA/CP045/photo.jpg'});
      await _pumpView(tester, _pump, photos);
      expect(
        find.byWidgetPredicate(
          (Widget w) => w is Image && w.image is NetworkImage,
        ),
        findsOneWidget,
      );
      expect(photos.signed, <String>['org/KSA/CP045/photo.jpg']);
    });

    testWidgets('without an upload shows the fleet class photo',
        (WidgetTester tester) async {
      await _pumpView(tester, _pump, _FakePhotos(const <String, String>{}));
      final Image image = tester.widget<Image>(find.byType(Image));
      expect(image.image, isA<AssetImage>());
      expect(
        (image.image as AssetImage).assetName,
        startsWith('assets/vehicle_photos/'),
      );
    });

    testWidgets('an unmatched class shows a neutral icon, not a vehicle',
        (WidgetTester tester) async {
      await _pumpView(
        tester,
        _unknownKind,
        _FakePhotos(const <String, String>{}),
      );
      expect(find.byType(Image), findsNothing);
      expect(find.byIcon(Icons.local_shipping_outlined), findsOneWidget);
    });
  });
}
