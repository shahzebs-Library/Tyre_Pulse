import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/domain/wash_areas.dart';
import 'package:tyre_pulse/features/washing/domain/wash_details.dart';

void main() {
  group('washTypeForAreas', () {
    test('nothing marked is not ready', () {
      expect(washTypeForAreas(<WashArea>{}), isNull);
    });

    test('outside and cabin together is a Full wash', () {
      expect(
        washTypeForAreas(<WashArea>{WashArea.exterior, WashArea.cabin}),
        'Full',
      );
    });

    test('steam wins over other areas except Full', () {
      expect(
        washTypeForAreas(<WashArea>{WashArea.steam, WashArea.engineBay}),
        'Steam',
      );
    });

    test('single areas map to their stored type', () {
      expect(washTypeForAreas(<WashArea>{WashArea.engineBay}), 'Engine Bay');
      expect(
        washTypeForAreas(<WashArea>{WashArea.undercarriage}),
        'Undercarriage',
      );
      expect(washTypeForAreas(<WashArea>{WashArea.cabin}), 'Interior');
      expect(washTypeForAreas(<WashArea>{WashArea.tyresRims}), 'Exterior');
      expect(washTypeForAreas(<WashArea>{WashArea.drumHopper}), 'Exterior');
    });

    test('waterless overrides the area mapping', () {
      expect(
        washTypeForAreas(<WashArea>{WashArea.exterior}, waterless: true),
        'Waterless',
      );
    });

    test('every derived value stays inside the wash_type CHECK list', () {
      for (final WashArea a in WashArea.values) {
        expect(kWashTypes, contains(washTypeForAreas(<WashArea>{a})));
      }
    });
  });

  group('areas offered per vehicle', () {
    test('drum and hopper only for mixers and pumps', () {
      expect(washAreasForVehicle('TR-MIXER'), contains(WashArea.drumHopper));
      expect(
        washAreasForVehicle('Concrete Pump'),
        contains(WashArea.drumHopper),
      );
      expect(
        washAreasForVehicle('PICKUP'),
        isNot(contains(WashArea.drumHopper)),
      );
      expect(washAreasForVehicle(null), isNot(contains(WashArea.drumHopper)));
      expect(washAreasForVehicle(null), contains(WashArea.engineBay));
    });
  });

  group('payload', () {
    test('areas and sides go into wash_details in a stable order', () {
      final Map<String, dynamic> out = withWashScope(
        emptyWashDetails(),
        areas: <WashArea>{WashArea.steam, WashArea.exterior},
        views: <WashView>{WashView.top, WashView.front},
      );
      expect(out['areas'], <String>['exterior', 'steam']);
      expect(out['views'], <String>['front', 'top']);
      // The existing keys the CHECK validates are untouched.
      expect(out['version'], 1);
      expect(out['chemical_status'], 'not_recorded');
      expect(out['chemicals'], isEmpty);
      expect(validWashDetails(out), isTrue);
    });

    test('reads back saved areas and ignores unknown keys', () {
      final Map<String, dynamic> d = <String, dynamic>{
        'areas': <Object?>['engine_bay', 'nonsense', 3, 'tyres_rims'],
        'views': <Object?>['left', 'under'],
      };
      expect(
        washAreasFromDetails(d),
        <WashArea>[WashArea.engineBay, WashArea.tyresRims],
      );
      expect(washViewsFromDetails(d), <WashView>[WashView.left]);
      expect(washAreasFromDetails(null), isEmpty);
    });
  });
}
