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

  test('photo path starts with the company folder', () {
    expect(storeReceiptPhotoPath('org', 'cu'), 'org/store_receipts/cu.jpg');
  });

  test('quantity reading: digits, separators and refusals', () {
    expect(parseReceiptQty(' 12 '), 12);
    expect(parseReceiptQty('2.5'), 2.5);
    expect(parseReceiptQty('\u0661\u0662'), 12, reason: 'Arabic-Indic');
    expect(parseReceiptQty('\u06F3'), 3, reason: 'Persian / Urdu');
    expect(
      parseReceiptQty('\u0662\u066B\u0665'),
      2.5,
      reason: 'Arabic decimal',
    );
    for (final String bad in <String>[
      '1,000',
      '1\u066C000',
      '2,5',
      'NaN',
      'Infinity',
      '0x10',
      '1e3',
      '-1',
      '+1',
      '1.2.3',
      'abc',
      '.5',
    ]) {
      expect(readReceiptQty(bad), isA<ReceiptQtyInvalid>(), reason: bad);
    }
    expect(readReceiptQty('  '), isA<ReceiptQtyEmpty>());
  });

  test('fromText: empty rejected is 0, unparseable rejected is an error', () {
    StoreReceiptDraft f(String rec, String rej, {String reason = ''}) =>
        StoreReceiptDraft.fromText(
          line: _line,
          received: rec,
          rejected: rej,
          locationId: 'loc-a',
          rejectionReason: reason,
        );
    expect(f('3', '').validate(), isNull);
    expect(f('3', '').qtyRejected, 0);
    expect(f('3', 'x').validate(), 'sr_rejectedInvalid');
    expect(f('1,000', '').validate(), 'sr_qtyInvalid');
    expect(f('', '').validate(), 'sr_qtyRequired');
    // a reason is dropped once nothing is rejected
    expect(f('3', '0', reason: 'Wet').rejectionReason, '');
    expect(f('3', '1', reason: 'Wet').rejectionReason, 'Wet');
  });
}
