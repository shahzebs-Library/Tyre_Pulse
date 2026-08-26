/// Coverage for the pure, I/O-free parts of the Work Orders data layer:
/// [workOrderCountryFilter] and [WorkOrderItem.fromRow].
///
/// Mirrors `test/features/approvals/data/inspection_approval_repository
/// _test.dart`'s own shape and its own reasoning for why
/// [SupabaseWorkOrderRepository] itself is not instantiated here: no test
/// file anywhere in this project constructs a real `SupabaseClient` against
/// a concrete `Supabase*Repository` implementation, and this feature builds
/// no controller/engine on top of [WorkOrderRepository] that would need a
/// hand-written fake of it either - the screens themselves are the only
/// consumers, and they are exercised through Riverpod overrides at the
/// widget level, not covered here.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';

void main() {
  group('workOrderCountryFilter', () {
    test('null country means no filter at all', () {
      expect(workOrderCountryFilter(null), isNull);
    });

    test('an empty or whitespace-only country means no filter', () {
      expect(workOrderCountryFilter(''), isNull);
      expect(workOrderCountryFilter('   '), isNull);
    });

    test("the 'All' sentinel means no filter", () {
      expect(workOrderCountryFilter('All'), isNull);
    });

    test('a real country scopes to it OR a null row country', () {
      // The exact shape `mobile/app/(app)/work-orders.tsx`'s own load()
      // builds - see this function's own library comment on the 55,606
      // country-less job cards a strict `.eq` once hid from every view.
      expect(
        workOrderCountryFilter('KSA'),
        'country.eq.KSA,country.is.null',
      );
    });
  });

  group('WorkOrderItem.fromRow', () {
    test('decodes every column of the DETAIL projection', () {
      final WorkOrderItem item = WorkOrderItem.fromRow(<String, Object?>{
        'id': 'wo-1',
        'work_order_no': 'WO-A1B2C3D4',
        'asset_no': 'TM514',
        'work_type': 'Repair',
        'status': 'In Progress',
        'priority': 'High',
        'description': 'Front axle noise',
        'site': 'NHC',
        'total_cost': 1250.5,
        'opened_at': '2026-08-20T09:00:00.000Z',
        'started_at': '2026-08-20T10:00:00.000Z',
        'completed_at': null,
        'country': 'KSA',
      });

      expect(item.id, 'wo-1');
      expect(item.workOrderNo, 'WO-A1B2C3D4');
      expect(item.assetNo, 'TM514');
      expect(item.workType, 'Repair');
      expect(item.status, 'In Progress');
      expect(item.priority, 'High');
      expect(item.description, 'Front axle noise');
      expect(item.site, 'NHC');
      expect(item.totalCost, 1250.5);
      expect(item.openedAt, '2026-08-20T09:00:00.000Z');
      expect(item.startedAt, '2026-08-20T10:00:00.000Z');
      expect(item.completedAt, isNull);
      expect(item.country, 'KSA');
    });

    test("every optional column may be absent (the list's lean select)", () {
      final WorkOrderItem item = WorkOrderItem.fromRow(<String, Object?>{
        'id': 'wo-2',
      });

      expect(item.id, 'wo-2');
      expect(item.workOrderNo, isNull);
      expect(item.assetNo, isNull);
      expect(item.workType, isNull);
      expect(item.status, isNull);
      expect(item.priority, isNull);
      expect(item.description, isNull);
      expect(item.site, isNull);
      expect(item.totalCost, isNull);
      expect(item.openedAt, isNull);
      // The three detail-only columns are null whether they were never
      // written OR never selected - a row decoded from the list's lean
      // columns cannot tell the two apart, and does not need to.
      expect(item.startedAt, isNull);
      expect(item.completedAt, isNull);
      expect(item.country, isNull);
    });

    test('a missing id throws a FormatException', () {
      expect(
        () => WorkOrderItem.fromRow(<String, Object?>{'x': 1}),
        throwsFormatException,
      );
    });

    test('an empty-string id throws a FormatException', () {
      expect(
        () => WorkOrderItem.fromRow(<String, Object?>{'id': ''}),
        throwsFormatException,
      );
    });

    test('a non-string id throws a FormatException', () {
      expect(
        () => WorkOrderItem.fromRow(<String, Object?>{'id': 42}),
        throwsFormatException,
      );
    });

    test('total_cost coerces from an int or a double alike', () {
      final WorkOrderItem fromInt = WorkOrderItem.fromRow(
        <String, Object?>{'id': 'a', 'total_cost': 100},
      );
      expect(fromInt.totalCost, 100);

      final WorkOrderItem fromDouble = WorkOrderItem.fromRow(
        <String, Object?>{'id': 'b', 'total_cost': 100.25},
      );
      expect(fromDouble.totalCost, 100.25);
    });

    test('blank string columns decode as null, not as empty strings', () {
      final WorkOrderItem item = WorkOrderItem.fromRow(<String, Object?>{
        'id': 'a',
        'asset_no': '   ',
        'description': '',
      });
      expect(item.assetNo, isNull);
      expect(item.description, isNull);
    });
  });
}
