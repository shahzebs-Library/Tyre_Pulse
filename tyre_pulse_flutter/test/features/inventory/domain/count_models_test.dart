import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';

void main() {
  group('blind count: expected figures never reach the counter', () {
    test('stripExpectedKeys removes expected, on-hand, cost and variance', () {
      final Object? out = stripExpectedKeys(<String, Object?>{
        'items': <Object?>[
          <String, Object?>{
            'item_id': 'i',
            'expected_qty': 5,
            'qty_on_hand': 5,
            'avg_unit_cost': 10,
            'variance': 1,
            'Expected_Serials': <String>['x'],
          },
        ],
      });
      final Map<String, Object?> item =
          ((out! as Map<String, Object?>)['items']! as List<Object?>).single!
              as Map<String, Object?>;
      expect(item.keys, <String>['item_id']);
      expect(isBlindForbiddenKey('unexpected'), isFalse);
      expect(isBlindForbiddenKey('value_impact'), isTrue);
    });

    test('the counter view parses scope, prompts and submitted ids', () {
      final AuditCounterView view =
          AuditCounterView.fromJson(const <String, Object?>{
        'audit': <String, Object?>{
          'id': 'a',
          'status': 'recount',
          'due_at': '2026-11-20T00:00:00Z',
        },
        'locations': <Object?>[
          <String, Object?>{'id': 'L1', 'code': 'B-1'},
          <String, Object?>{'code': 'no-id'},
        ],
        'items': <Object?>[
          <String, Object?>{'location_id': 'L1', 'item_id': 'I1'},
        ],
        'submitted': <Object?>['c1', '', null],
      });
      expect(view.audit.acceptsCounts, isTrue);
      expect(view.locations.map((AuditLocation l) => l.id), <String>['L1']);
      expect(view.promptsAt('L1').single.itemId, 'I1');
      expect(view.submittedClientUuids, <String>{'c1'});
    });

    test('only assigned / in_progress / recount accept counts', () {
      for (final String s in <String>['assigned', 'in_progress', 'recount']) {
        expect(
          InventoryAuditSummary(id: 'x', status: s).acceptsCounts,
          isTrue,
        );
      }
      for (final String s in <String>['draft', 'closed', 'approval']) {
        expect(
          InventoryAuditSummary(id: 'x', status: s).acceptsCounts,
          isFalse,
        );
      }
    });
  });

  test('submit result: duplicates count as accepted (idempotent replay)', () {
    final CountSubmitResult r =
        CountSubmitResult.fromJson(const <String, Object?>{
      'accepted': <String>['a'],
      'duplicates': <String>['b'],
      'rejected': <Object?>[
        <String, Object?>{'client_uuid': 'c', 'reason': 'Audit closed'},
      ],
    });
    expect(r.accepted, <String>{'a', 'b'});
    expect(r.rejected, <String, String>{'c': 'Audit closed'});
    expect(CountSubmitResult.fromJson(null).accepted, isEmpty);
  });

  group('transfers', () {
    test('dispatch needs distinct locations and positive lines', () {
      const List<DispatchLineDraft> one = <DispatchLineDraft>[
        DispatchLineDraft(code: 'X'),
      ];
      expect(
        dispatchProblem(fromLocationId: null, toLocationId: 'b', lines: one),
        'needFrom',
      );
      expect(
        dispatchProblem(fromLocationId: 'a', toLocationId: 'a', lines: one),
        'sameLocation',
      );
      expect(
        dispatchProblem(
          fromLocationId: 'a',
          toLocationId: 'b',
          lines: const <DispatchLineDraft>[],
        ),
        'needLines',
      );
      expect(
        dispatchProblem(
          fromLocationId: 'a',
          toLocationId: 'b',
          lines: const <DispatchLineDraft>[
            DispatchLineDraft(code: 'X', qty: 0),
          ],
        ),
        'invalidQty',
      );
      expect(
        dispatchProblem(fromLocationId: 'a', toLocationId: 'b', lines: one),
        isNull,
      );
    });

    test('receive refuses negatives and empty receipts', () {
      expect(receiveProblem(const <ReceiveLineDraft>[]), 'needLines');
      expect(
        receiveProblem(const <ReceiveLineDraft>[
          ReceiveLineDraft(lineId: 'l', receivedQty: -1),
        ]),
        'invalidQty',
      );
    });

    test('outstanding never goes negative and is unknown without a qty', () {
      expect(
        const StockTransferLine(id: 'l', qtyDispatched: 3, qtyReceived: 5)
            .outstanding,
        0,
      );
      expect(const StockTransferLine(id: 'l').outstanding, isNull);
      final StockTransfer t = StockTransfer.fromJson(const <String, Object?>{
        'id': 't',
        'status': 'in_transit',
        'stock_transfer_lines': <Object?>[
          <String, Object?>{'id': 'l1', 'qty_dispatched': 2},
        ],
      });
      expect(t.awaitingReceipt, isTrue);
      expect(t.lines.single.outstanding, 2);
    });
  });
}
