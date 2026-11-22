// Pins the phone's calls to the DB lane's client contract
// (docs/inventory/10_DB_IMPLEMENTATION.md section 3).
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';

void main() {
  test('inv_count_submit takes one p_payload {audit_id, device_id, lines}', () {
    final CountLine line = CountLine(
      clientUuid: '11111111-1111-1111-1111-111111111111',
      locationId: 'loc-1',
      scannedCode: 'TP:LOC:loc-1',
      countedAt: DateTime.utc(2026, 11, 20, 8),
      itemId: 'item-1',
      countedQty: 3,
    );
    final Map<String, Object?> params = countSubmitParams(
      auditId: 'audit-1',
      deviceId: 'device-9',
      lines: <CountLine>[line],
    );
    expect(params.keys, <String>['p_payload']);
    final Map<String, Object?> payload =
        params['p_payload']! as Map<String, Object?>;
    expect(payload['audit_id'], 'audit-1');
    expect(payload['device_id'], 'device-9');
    final List<Object?> lines = payload['lines']! as List<Object?>;
    expect(lines, hasLength(1));
    expect(lines.single, line.toSubmitJson());
    // The old positional arguments are gone.
    expect(params.containsKey('p_audit_id'), isFalse);
    expect(params.containsKey('p_lines'), isFalse);
  });

  test(
      'inv_audit_complete_counting takes one p_payload '
      '{audit_id, idempotency_key} (same shape as the web)', () {
    final Map<String, Object?> params = completeCountingParams(
      auditId: 'audit-1',
      idempotencyKey: 'key-1',
    );
    expect(params.keys, <String>['p_payload']);
    expect(params['p_payload'], <String, Object?>{
      'audit_id': 'audit-1',
      'idempotency_key': 'key-1',
    });
  });

  test('transfer lines take the item code from the item-master embed', () {
    final StockTransferLine line =
        StockTransferLine.fromJson(const <String, Object?>{
      'id': 'l1',
      'item_id': 'i1',
      'qty_dispatched': 5,
      'qty_received': 2,
      'itm': <String, Object?>{'item_code': '315/80R22.5', 'item_name': 'Tyre'},
    });
    expect(line.itemCode, '315/80R22.5');
    expect(line.description, 'Tyre');
    final StockTransferLine plain = StockTransferLine.fromJson(
      const <String, Object?>{'id': 'l2', 'item_code': 'X', 'description': 'D'},
    );
    expect(plain.itemCode, 'X');
    expect(plain.description, 'D');
  });
}
