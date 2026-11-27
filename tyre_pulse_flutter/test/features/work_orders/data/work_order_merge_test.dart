import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';

void main() {
  group('mergeWorkOrderRows', () {
    test('open cards come first even when every recent card is closed', () {
      final List<Map<String, dynamic>> open = <Map<String, dynamic>>[
        <String, dynamic>{'id': 'a', 'status': 'In Progress'},
      ];
      final List<Map<String, dynamic>> recent = <Map<String, dynamic>>[
        <String, dynamic>{'id': 'x', 'status': 'Closed'},
        <String, dynamic>{'id': 'y', 'status': 'Closed'},
      ];
      final List<Object?> ids = mergeWorkOrderRows(open, recent)
          .map((Map<String, dynamic> r) => r['id'])
          .toList();
      expect(ids, <Object?>['a', 'x', 'y']);
    });

    test('a card in both reads appears once', () {
      final List<Map<String, dynamic>> open = <Map<String, dynamic>>[
        <String, dynamic>{'id': 'a', 'status': 'Open'},
      ];
      final List<Map<String, dynamic>> recent = <Map<String, dynamic>>[
        <String, dynamic>{'id': 'a', 'status': 'Open'},
        <String, dynamic>{'id': 'b', 'status': 'Closed'},
      ];
      expect(mergeWorkOrderRows(open, recent), hasLength(2));
    });

    test('closed-status filter names every finished status', () {
      for (final String s in <String>['Closed', 'Completed', 'Cancelled']) {
        expect(workOrderClosedStatusFilter, contains('"$s"'));
      }
      expect(workOrderClosedStatusFilter, isNot(contains('In Progress')));
    });
  });
}
