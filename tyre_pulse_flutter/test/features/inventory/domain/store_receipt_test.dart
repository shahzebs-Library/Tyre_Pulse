// Store keeper phone receipt draft: local checks mirror the server's, and the
// payload never carries a price.
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inventory/domain/store_receipt.dart';

const OpenPoLine _line = OpenPoLine(
  poLineId: 'pl-1',
  poNumber: 'PO-1',
  qtyOrdered: 10,
  qtyOpen: 6,
  site: 'NHC',
  locationId: 'loc-b',
);

StoreReceiptDraft _d({
  num? qty = 5,
  num? rej = 0,
  String reason = '',
  String? loc = 'loc-a',
}) =>
    StoreReceiptDraft(
      line: _line,
      qtyReceived: qty,
      qtyRejected: rej,
      rejectionReason: reason,
      locationId: loc,
    );

void main() {
  test('validate: quantity, rejection, open quantity and location', () {
    expect(_d(qty: null).validate(), 'sr_qtyRequired');
    expect(_d(qty: 0).validate(), 'sr_qtyPositive');
    expect(_d(qty: 200000).validate(), 'sr_qtyTooLarge');
    expect(_d(rej: 6).validate(), 'sr_rejectedRange');
    expect(_d(rej: 1).validate(), 'sr_reasonRequired');
    expect(_d(qty: 7).validate(), 'sr_overOpen');
    // rejected goods do not use the open quantity
    expect(_d(qty: 8, rej: 2, reason: 'Wet').validate(), isNull);
    expect(_d(loc: null).validate(), 'sr_locationRequired');
    expect(_d().validate(), isNull);
  });

  test('payload has no price, cost or currency', () {
    final Map<String, Object?> p = _d().toPayload('cu-1');
    expect(p['client_uuid'], 'cu-1');
    expect(p['po_line_id'], 'pl-1');
    for (final String k in <String>[
      'unit_cost',
      'unit_price',
      'price',
      'cost',
      'currency',
    ]) {
      expect(p.containsKey(k), isFalse, reason: k);
    }
  });

  test('board parses rows and puts the line location first', () {
    final StoreReceiptBoard b = StoreReceiptBoard.fromJson(<String, Object?>{
      'lines': <Object?>[
        <String, Object?>{
          'po_line_id': 'pl-1',
          'po_number': 'PO-1',
          'qty_ordered': '10',
          'qty_open': 6,
          'site': 'NHC',
          'location_id': 'loc-b',
        },
        <String, Object?>{'po_number': 'no id'},
      ],
      'locations': <Object?>[
        <String, Object?>{'id': 'loc-a', 'code': 'A', 'site': 'NHC'},
        <String, Object?>{'id': 'loc-b', 'code': 'B', 'site': 'NHC'},
        <String, Object?>{'id': 'loc-c', 'code': 'C', 'site': 'JED'},
      ],
      'mine': <Object?>[
        <String, Object?>{'id': 'r1', 'status': 'approved'},
      ],
    });
    expect(b.lines, hasLength(1));
    expect(b.lines.single.qtyOrdered, 10);
    expect(
      b.locationsFor(b.lines.single).map((ReceivingLocation l) => l.id),
      <String>['loc-b', 'loc-a'],
    );
    expect(b.mine.single.isPending, isFalse);
    expect(StoreReceiptBoard.fromJson(null).lines, isEmpty);
  });

  test('photo path is under store_receipts/<company>/', () {
    expect(storeReceiptPhotoPath('org', 'cu'), 'store_receipts/org/cu.jpg');
    expect(parseReceiptQty(' 2,5 '), 2.5);
    expect(parseReceiptQty(''), isNull);
  });
}
