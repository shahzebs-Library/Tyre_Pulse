import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';

void main() {
  test('fleet cache uses the application database cache DAO', () async {
    final AppDatabase database = AppDatabase(NativeDatabase.memory());
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        appDatabaseProvider.overrideWithValue(database),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await database.close();
    });

    expect(
      container.read(vehicleFleetCacheDaoProvider),
      same(database.cacheDao),
    );
  });
}
