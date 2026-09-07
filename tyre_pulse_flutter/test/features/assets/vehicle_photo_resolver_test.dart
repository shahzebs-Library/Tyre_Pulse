import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

void main() {
  group('asset-number fallback parity', () {
    const Map<String, String?> expectedPhotos = <String, String?>{
      'CP-045': 'assets/vehicle_photos/concrete_pump.png',
      'MP045': 'assets/vehicle_photos/concrete_pump.png',
      'TM 214': 'assets/vehicle_photos/tri_mixer_perspective.webp',
      'BH-037': 'assets/vehicle_photos/staff_bus.png',
      'MB003': 'assets/vehicle_photos/staff_bus.png',
      'WL003': 'assets/vehicle_photos/wheel_loader.png',
      'PL-090': null,
      'LP003': 'assets/vehicle_photos/truck_mounted_pump.png',
    };

    for (final MapEntry<String, String?> entry in expectedPhotos.entries) {
      test('${entry.key} resolves to its existing class artwork', () {
        final VehicleAsset asset = VehicleAsset(
          id: 'vehicle-${entry.key}',
          assetNo: entry.key,
          vehicleType: 'HEAVY EQP',
        );

        expect(vehiclePhotoAsset(asset), entry.value);
      });
    }

    test('SL without a verified make does not borrow CAT artwork', () {
      const VehicleAsset asset = VehicleAsset(
        id: 'vehicle-sl',
        assetNo: 'SL019',
        vehicleType: 'HEAVY EQP',
      );

      expect(vehiclePhotoAsset(asset), isNull);
      expect(vehicleFallbackIcon(asset), Icons.construction_outlined);
    });
  });

  test('unknown fleet classes do not receive a misleading photo', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-2',
      assetNo: 'UNKNOWN-1',
    );

    expect(vehiclePhotoAsset(asset), isNull);
  });

  test('TR-MIXER assets resolve to the real perspective mixer artwork', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-3',
      assetNo: 'TM-214',
      vehicleType: 'TR-MIXER',
    );

    expect(
      vehiclePhotoAsset(asset),
      'assets/vehicle_photos/tri_mixer_perspective.webp',
    );
  });

  test('an explicit registered class wins over a historical fleet prefix', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-4',
      assetNo: 'TM514',
      vehicleType: 'Concrete Pump',
    );

    expect(
      vehiclePhotoAsset(asset),
      'assets/vehicle_photos/concrete_pump.png',
    );
  });

  test('an explicit no-photo road class is not overridden by a prefix', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-truck',
      assetNo: 'PL077',
      vehicleType: 'Truck 6x4',
    );

    expect(vehiclePhotoAsset(asset), isNull);
    expect(vehicleFallbackIcon(asset), Icons.local_shipping_outlined);
  });

  group('bus and van variants', () {
    const Map<String, String> variants = <String, String>{
      'Toyota Hiace': 'assets/vehicle_photos/hiace_fleet.jpeg',
      'Hi-Ace staff van': 'assets/vehicle_photos/hiace_fleet.jpeg',
      'Mini bus': 'assets/vehicle_photos/staff_bus.png',
      '32 seater coach': 'assets/vehicle_photos/staff_bus.png',
      '62-seater staff transport': 'assets/vehicle_photos/staff_bus.png',
      'Tata staff bus': 'assets/vehicle_photos/tata_bus_fleet.jpeg',
      'Ashok Leyland staff bus': 'assets/vehicle_photos/ashok_bus_fleet.jpeg',
    };

    for (final MapEntry<String, String> entry in variants.entries) {
      final String variant = entry.key;
      test('$variant resolves to the bundled staff-bus artwork', () {
        final VehicleAsset asset = VehicleAsset(
          id: 'vehicle-$variant',
          vehicleType: variant,
        );

        expect(vehiclePhotoAsset(asset), entry.value);
        expect(vehicleFallbackIcon(asset), Icons.directions_bus_outlined);
      });
    }
  });

  test('unbranded double-cabin uses an honest fallback icon', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-double-cab',
      vehicleType: 'Double Cabin Pickup',
    );

    expect(vehiclePhotoAsset(asset), isNull);
    expect(vehicleFallbackIcon(asset), Icons.airport_shuttle_outlined);
  });

  test('truck-mounted pump is checked before generic concrete pump', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-truck-pump',
      vehicleType: 'Truck Mounted Concrete Pump',
    );

    expect(
      vehiclePhotoAsset(asset),
      'assets/vehicle_photos/truck_mounted_pump.png',
    );
  });

  test('towable pump uses its own one-axle equipment artwork', () {
    const VehicleAsset asset = VehicleAsset(
      id: 'vehicle-towable-pump',
      make: 'SANY',
      vehicleType: 'Towable concrete pump',
    );

    expect(
      vehiclePhotoAsset(asset),
      'assets/vehicle_photos/towable_pump_fleet.jpeg',
    );
    expect(vehicleFallbackIcon(asset), Icons.rv_hookup_outlined);
  });

  group('make and model fields resolve without flattening unknown brands', () {
    final Map<VehicleAsset, String> namedModels = <VehicleAsset, String>{
      const VehicleAsset(
        id: 'hiace-fields',
        make: 'Toyota',
        model: 'Hiace',
        vehicleType: 'Staff van',
      ): 'assets/vehicle_photos/hiace_fleet.jpeg',
      const VehicleAsset(
        id: 'xenon-fields',
        make: 'Tata',
        model: 'Xenon',
        vehicleType: 'Light vehicle',
      ): 'assets/vehicle_photos/tata_xenon_double_cab.jpeg',
      const VehicleAsset(
        id: 'l200-fields',
        make: 'Mitsubishi',
        model: 'L200',
        vehicleType: 'Light vehicle',
      ): 'assets/vehicle_photos/mitsubishi_double_cab_front.jpeg',
      const VehicleAsset(
        id: 'lg-fields',
        make: 'LG',
        model: 'Industrial water chiller',
        vehicleType: 'Chiller',
      ): 'assets/vehicle_photos/industrial_chiller_fleet.jpeg',
    };

    for (final MapEntry<VehicleAsset, String> entry in namedModels.entries) {
      test(entry.key.id, () {
        expect(vehiclePhotoAsset(entry.key), entry.value);
      });
    }

    const List<VehicleAsset> conflictingMakes = <VehicleAsset>[
      VehicleAsset(
        id: 'cummins-generator',
        assetNo: 'GN101',
        make: 'Cummins',
        vehicleType: 'Generator',
      ),
      VehicleAsset(
        id: 'cat-wheel-loader',
        make: 'CAT',
        vehicleType: 'Wheel loader',
      ),
      VehicleAsset(
        id: 'carrier-chiller',
        make: 'Carrier',
        vehicleType: 'Chiller',
      ),
    ];

    for (final VehicleAsset asset in conflictingMakes) {
      test('${asset.id} does not borrow a different make', () {
        expect(vehiclePhotoAsset(asset), isNull);
      });
    }
  });

  group('verified make/model takes precedence over legacy type', () {
    test('Toyota Hiace typed as PICKUP still renders the Hiace', () {
      const VehicleAsset asset = VehicleAsset(
        id: 'toyota-hiace-import',
        make: 'TOYOTA HIACE',
        vehicleType: 'PICKUP',
      );

      expect(
        vehiclePhotoAsset(asset),
        'assets/vehicle_photos/hiace_fleet.jpeg',
      );
      expect(
        vehicleMultiViewAsset(asset),
        'assets/vehicle_multiview/toyota_hiace_five_view_v1.png',
      );
    });

    test('Toyota BUS without a model does not assume a Hiace body', () {
      const VehicleAsset asset = VehicleAsset(
        id: 'toyota-bus',
        make: 'Toyota',
        vehicleType: 'BUS',
      );

      expect(
        vehiclePhotoAsset(asset),
        isNull,
      );
    });

    test('Ashok Leyland and Tata buses never share generic artwork', () {
      const VehicleAsset ashok = VehicleAsset(
        id: 'ashok-live',
        make: 'Ashok Leyland',
        vehicleType: 'BUS',
      );
      const VehicleAsset tata = VehicleAsset(
        id: 'tata-live',
        make: 'Tata',
        vehicleType: 'BUS',
      );

      expect(
        vehiclePhotoAsset(ashok),
        'assets/vehicle_photos/ashok_bus_fleet.jpeg',
      );
      expect(
        vehiclePhotoAsset(tata),
        'assets/vehicle_photos/tata_bus_fleet.jpeg',
      );
    });

    test('unknown branded bus does not borrow another manufacturer', () {
      const VehicleAsset asset = VehicleAsset(
        id: 'foton-bus',
        make: 'FOTON',
        vehicleType: 'BUS',
      );

      expect(vehiclePhotoAsset(asset), isNull);
      expect(vehicleMultiViewAsset(asset), isNull);
    });

    test('non-SANY loader and generator do not borrow SANY artwork', () {
      const VehicleAsset xcmg = VehicleAsset(
        id: 'xcmg-loader',
        make: 'XCMG',
        vehicleType: 'WHEEL_LOADER',
      );
      const VehicleAsset cummins = VehicleAsset(
        id: 'cummins-generator-live',
        make: 'CUMMINS',
        vehicleType: 'GENERATOR',
      );

      expect(vehiclePhotoAsset(xcmg), isNull);
      expect(vehicleMultiViewAsset(xcmg), isNull);
      expect(vehiclePhotoAsset(cummins), isNull);
      expect(vehicleMultiViewAsset(cummins), isNull);
    });

    test('generic WL fleet row receives the wheel-loader class artwork', () {
      const VehicleAsset asset = VehicleAsset(
        id: 'wl068',
        assetNo: 'WL068',
        make: 'WHEEL_LOADER',
        vehicleType: 'WHEEL_LOADER',
      );

      expect(
        vehiclePhotoAsset(asset),
        'assets/vehicle_photos/wheel_loader.png',
      );
      expect(vehicleMultiViewAsset(asset), isNotNull);
    });

    test('chiller imagery is brand-specific', () {
      const VehicleAsset snowkey = VehicleAsset(
        id: 'snowkey-live',
        make: 'Snowkey',
        vehicleType: 'CHILLER',
      );
      const VehicleAsset kti = VehicleAsset(
        id: 'kti-live',
        make: 'KTI',
        vehicleType: 'CHILLER',
      );

      expect(
        vehiclePhotoAsset(snowkey),
        'assets/vehicle_photos/chiller_fleet.jpeg',
      );
      expect(vehiclePhotoAsset(kti), isNull);
      expect(vehicleMultiViewAsset(kti), isNull);
    });
  });

  group('tyreless equipment', () {
    const List<String> descriptions = <String>[
      'Generator',
      'Genset',
      'Chiller',
      'Reclaimer',
      'Air Compressor',
      'Tower Light',
      'Batching Plant',
      'Placing Boom',
      'Stationary Pump',
      'Building',
    ];

    for (final String description in descriptions) {
      test('$description never borrows vehicle artwork', () {
        final VehicleAsset asset = VehicleAsset(
          id: 'equipment-$description',
          assetNo: 'MP001',
          vehicleType: description,
        );

        expect(vehiclePhotoAsset(asset), isNull);
        expect(
          vehicleFallbackIcon(asset),
          Icons.precision_manufacturing_outlined,
        );
      });
    }

    const Map<String, String?> documentedTyrelessPrefixes = <String, String?>{
      'GN103': null,
      'BP014': null,
      'IP-005': null,
      'SP 021': null,
      'PB008': null,
    };

    for (final MapEntry<String, String?> entry
        in documentedTyrelessPrefixes.entries) {
      final String assetNo = entry.key;
      test('$assetNo gets the equipment fallback with a blank type', () {
        final VehicleAsset asset = VehicleAsset(
          id: 'equipment-$assetNo',
          assetNo: assetNo,
        );

        expect(vehiclePhotoAsset(asset), entry.value);
        expect(
          vehicleFallbackIcon(asset),
          Icons.precision_manufacturing_outlined,
        );
      });
    }
  });
}
