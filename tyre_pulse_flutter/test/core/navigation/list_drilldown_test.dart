import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/navigation/list_drilldown.dart';

void main() {
  test('a request is taken once, by its own kind only', () {
    final ListDrilldownBox box = ListDrilldownBox()
      ..request(ListDrilldown.offRoad);
    expect(box.take(ListDrilldown.openAccidents), isFalse);
    expect(box.take(ListDrilldown.offRoad), isTrue);
    expect(box.take(ListDrilldown.offRoad), isFalse);
  });

  test('a newer request replaces an untaken one', () {
    final ListDrilldownBox box = ListDrilldownBox()
      ..request(ListDrilldown.offRoad)
      ..request(ListDrilldown.maintenanceOverdue);
    expect(box.take(ListDrilldown.offRoad), isFalse);
    expect(box.take(ListDrilldown.maintenanceOverdue), isTrue);
  });
}
