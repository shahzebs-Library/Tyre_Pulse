
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/navigation/list_drilldown.dart';

void main() {
  late DateTime now;
  late ProviderContainer container;
  ListDrilldownController controller() =>
      container.read(listDrilldownProvider.notifier);

  setUp(() {
    now = DateTime(2026, 11, 28, 9);
    container = ProviderContainer(
      overrides: [listDrilldownClockProvider.overrideWithValue(() => now)],
    );
  });
  tearDown(() => container.dispose());

  test('a request is taken once, by its own kind only, then cleared', () async {
    controller().request(ListDrilldown.offRoad);
    expect(controller().take(ListDrilldown.openAccidents), isFalse);
    expect(controller().take(ListDrilldown.offRoad), isTrue);
    expect(controller().take(ListDrilldown.offRoad), isFalse);
    await Future<void>.delayed(Duration.zero);
    expect(container.read(listDrilldownProvider), isNull);
  });

  test('two taps of the same tile are two requests', () {
    controller().request(ListDrilldown.openAccidents);
    expect(controller().take(ListDrilldown.openAccidents), isTrue);
    controller().request(ListDrilldown.openAccidents);
    expect(controller().take(ListDrilldown.openAccidents), isTrue);
  });

  test('a stale request is refused and cleared', () async {
    controller().request(ListDrilldown.offRoad);
    now = now.add(kListDrilldownTtl + const Duration(seconds: 1));
    expect(controller().take(ListDrilldown.offRoad), isFalse);
    await Future<void>.delayed(Duration.zero);
    expect(container.read(listDrilldownProvider), isNull);
  });

  test('a newer request replaces an untaken one', () {
    controller()
      ..request(ListDrilldown.offRoad)
      ..request(ListDrilldown.maintenanceOverdue);
    expect(controller().take(ListDrilldown.offRoad), isFalse);
    expect(controller().take(ListDrilldown.maintenanceOverdue), isTrue);
  });
}
