import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_asset_hours_repository.dart';

void main() {
  group('engineHoursFromRow', () {
    test('reads a numeric reading', () {
      expect(engineHoursFromRow(<String, dynamic>{'engine_hours': 8742}), 8742);
      expect(
        engineHoursFromRow(<String, dynamic>{'engine_hours': '12.5'}),
        12.5,
      );
    });

    test('zero is a reading, not a gap', () {
      expect(engineHoursFromRow(<String, dynamic>{'engine_hours': 0}), 0);
    });

    test('missing, junk or negative values are not readings', () {
      expect(engineHoursFromRow(<String, dynamic>{}), isNull);
      expect(
        engineHoursFromRow(<String, dynamic>{'engine_hours': 'n/a'}),
        isNull,
      );
      expect(
        engineHoursFromRow(<String, dynamic>{'engine_hours': -4}),
        isNull,
      );
    });
  });
}
