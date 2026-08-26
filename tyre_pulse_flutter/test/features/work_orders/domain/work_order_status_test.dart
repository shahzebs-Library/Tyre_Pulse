/// Unit coverage for the pure status-ladder, tone-mapping and vocabulary
/// logic in `lib/features/work_orders/domain/work_order_status.dart`,
/// ported test-case-for-test-case from the intent of `mobile/app/(app)/
/// work-orders.tsx`'s own `NEXT_STATUS`/`WO_STATUS_KIND`/`PRI_KIND` maps
/// and its inline active-filter expression.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';

void main() {
  group('nextWorkOrderStatus', () {
    test('open advances to In Progress', () {
      expect(nextWorkOrderStatus('Open'), kWorkOrderStatusInProgress);
      expect(nextWorkOrderStatus('open'), kWorkOrderStatusInProgress);
      expect(nextWorkOrderStatus('OPEN'), kWorkOrderStatusInProgress);
    });

    test('in progress advances to Completed', () {
      expect(nextWorkOrderStatus('In Progress'), kWorkOrderStatusCompleted);
      expect(nextWorkOrderStatus('in progress'), kWorkOrderStatusCompleted);
    });

    test('completed has nothing further to advance to', () {
      expect(nextWorkOrderStatus('Completed'), isNull);
      expect(nextWorkOrderStatus('completed'), isNull);
    });

    test('closed has nothing further to advance to', () {
      expect(nextWorkOrderStatus('Closed'), isNull);
    });

    test('an unrecognised status has nothing to advance to', () {
      expect(nextWorkOrderStatus('Cancelled'), isNull);
      expect(nextWorkOrderStatus('Something Else'), isNull);
    });

    test('a null or blank status is treated as open', () {
      // Matches the reference's own `(wo.status ?? 'open').toLowerCase()`
      // read BEFORE the lookup - a freshly created row still gets an
      // advance action even before it has settled.
      expect(nextWorkOrderStatus(null), kWorkOrderStatusInProgress);
      expect(nextWorkOrderStatus(''), kWorkOrderStatusInProgress);
      expect(nextWorkOrderStatus('   '), kWorkOrderStatusInProgress);
    });
  });

  group('isWorkOrderStatusOpenLike', () {
    test('open is active', () {
      expect(isWorkOrderStatusOpenLike('Open'), isTrue);
    });

    test('in progress is active', () {
      expect(isWorkOrderStatusOpenLike('In Progress'), isTrue);
    });

    test('completed is not active', () {
      expect(isWorkOrderStatusOpenLike('Completed'), isFalse);
      expect(isWorkOrderStatusOpenLike('completed'), isFalse);
      expect(isWorkOrderStatusOpenLike('COMPLETED'), isFalse);
    });

    test('closed is not active', () {
      expect(isWorkOrderStatusOpenLike('Closed'), isFalse);
    });

    test('an unrecognised status is treated as active', () {
      // Matches the reference's own exclusion-list shape: anything not
      // explicitly named completed/closed counts as active, including a
      // status this vocabulary has never seen (e.g. a legacy "Cancelled"
      // row, measured live per PROJECT_MEMORY).
      expect(isWorkOrderStatusOpenLike('Cancelled'), isTrue);
    });

    test('a null or blank status is active', () {
      // DELIBERATELY not coerced to 'open' the way nextWorkOrderStatus
      // does - the reference's own filter never performs that coercion
      // either, it simply checks the raw (possibly empty) string is not
      // in the exclusion list.
      expect(isWorkOrderStatusOpenLike(null), isTrue);
      expect(isWorkOrderStatusOpenLike(''), isTrue);
    });
  });

  group('workOrderStatusTone', () {
    test('open is info', () {
      expect(workOrderStatusTone('Open'), WorkOrderTone.info);
    });

    test('in progress is warning', () {
      expect(workOrderStatusTone('In Progress'), WorkOrderTone.warning);
    });

    test('completed is ok', () {
      expect(workOrderStatusTone('Completed'), WorkOrderTone.ok);
    });

    test('closed is neutral', () {
      expect(workOrderStatusTone('Closed'), WorkOrderTone.neutral);
    });

    test('case is ignored', () {
      expect(workOrderStatusTone('COMPLETED'), WorkOrderTone.ok);
      expect(workOrderStatusTone('cOmPleTed'), WorkOrderTone.ok);
    });

    test('an unrecognised or blank status is neutral, never guessed', () {
      expect(workOrderStatusTone('Cancelled'), WorkOrderTone.neutral);
      expect(workOrderStatusTone(null), WorkOrderTone.neutral);
      expect(workOrderStatusTone(''), WorkOrderTone.neutral);
    });
  });

  group('workOrderPriorityTone', () {
    test('low is ok', () {
      expect(workOrderPriorityTone('Low'), WorkOrderTone.ok);
    });

    test('medium is warning', () {
      expect(workOrderPriorityTone('Medium'), WorkOrderTone.warning);
    });

    test('high and critical are both critical - the disclosed compression', () {
      expect(workOrderPriorityTone('High'), WorkOrderTone.critical);
      expect(workOrderPriorityTone('Critical'), WorkOrderTone.critical);
    });

    test('case is ignored', () {
      expect(workOrderPriorityTone('HIGH'), WorkOrderTone.critical);
    });

    test('an unrecognised or blank priority is neutral', () {
      expect(workOrderPriorityTone('Urgent'), WorkOrderTone.neutral);
      expect(workOrderPriorityTone(null), WorkOrderTone.neutral);
      expect(workOrderPriorityTone(''), WorkOrderTone.neutral);
    });
  });

  group('fixed vocabularies', () {
    test('work types match the reference, in order', () {
      expect(kWorkOrderWorkTypes, <String>[
        'Tyre Change',
        'Repair',
        'Rotation',
        'Alignment',
        'Inspection',
        'Other',
      ]);
    });

    test('priorities match the reference, in order', () {
      expect(kWorkOrderPriorities, <String>[
        'Low',
        'Medium',
        'High',
        'Critical',
      ]);
    });

    test(
      'the default work type and priority are in their own vocabularies',
      () {
        expect(kWorkOrderWorkTypes, contains(kWorkOrderDefaultWorkType));
        expect(kWorkOrderPriorities, contains(kWorkOrderDefaultPriority));
      },
    );

    test('a freshly created work order starts Open', () {
      expect(kWorkOrderInitialStatus, 'Open');
    });
  });
}
