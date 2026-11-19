import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/domain/inventory_scan.dart';

AuditCounterView _view() => AuditCounterView.fromJson(const <String, Object?>{
      'audit': <String, Object?>{
        'id': 'aud1',
        'ref': 'AUD-1',
        'status': 'in_progress',
      },
      'locations': <Object?>[
        <String, Object?>{'id': 'L1', 'code': 'A-01'},
        <String, Object?>{'id': 'L2', 'code': 'A-02'},
      ],
      'items': <Object?>[
        <String, Object?>{
          'location_id': 'L1',
          'item_id': 'I-FILTER',
          'item_code': 'FLT-100',
          'description': 'Oil filter',
          'expected_qty': 12,
        },
        <String, Object?>{
          'location_id': 'L1',
          'item_id': 'I-TYRE',
          'item_code': '315/80R22.5',
          'serial_tracked': true,
        },
      ],
    });

void main() {
  int seq = 0;
  String newId() => 'u${++seq}';
  final DateTime t0 = DateTime.utc(2026, 11, 19, 8);

  setUp(() => seq = 0);

  CountSession fresh() =>
      CountSession(auditId: 'aud1', userId: 'me', startedAt: t0);

  test('an item scanned before a location is refused', () {
    final ScanResult r = fresh().applyScan(
      raw: 'FLT-100',
      view: _view(),
      newId: newId,
      now: t0,
    );
    expect(r.outcome, ScanOutcome.needsLocation);
    expect(r.session.lines, isEmpty);
  });

  test('a location label selects the location; out-of-scope is refused', () {
    final AuditCounterView view = _view();
    final ScanResult ok = fresh()
        .applyScan(raw: 'TP:LOC:L1\r\n', view: view, newId: newId, now: t0);
    expect(ok.outcome, ScanOutcome.locationSelected);
    expect(ok.session.activeLocationId, 'L1');
    final ScanResult bad =
        fresh().applyScan(raw: 'TP:LOC:ZZ', view: view, newId: newId, now: t0);
    expect(bad.outcome, ScanOutcome.locationOutOfScope);
    expect(bad.session.activeLocationId, isNull);
  });

  test('a bulk item opens a line with NO quantity, a rescan reopens it', () {
    final AuditCounterView view = _view();
    CountSession s = fresh().selectLocation('L1');
    final ScanResult first =
        s.applyScan(raw: 'flt-100', view: view, newId: newId, now: t0);
    expect(first.outcome, ScanOutcome.lineAdded);
    expect(first.line!.itemId, 'I-FILTER');
    expect(first.line!.countedQty, isNull, reason: 'blind: never pre-filled');
    expect(first.line!.unexpected, isFalse);
    s = first.session;
    final ScanResult again = s.applyScan(
      raw: 'FLT-100',
      view: view,
      newId: newId,
      now: t0.add(const Duration(seconds: 5)),
    );
    expect(again.outcome, ScanOutcome.lineReopened);
    expect(again.session.lines, hasLength(1));
  });

  test('an identical scan inside the repeat window is ignored', () {
    final AuditCounterView view = _view();
    final CountSession s = fresh()
        .selectLocation('L1')
        .applyScan(raw: 'FLT-100', view: view, newId: newId, now: t0)
        .session;
    final ScanResult repeat = s.applyScan(
      raw: 'FLT-100',
      view: view,
      newId: newId,
      now: t0.add(const Duration(milliseconds: 300)),
    );
    expect(repeat.outcome, ScanOutcome.ignoredRepeat);
  });

  test('an unknown code becomes an UNEXPECTED line, never dropped', () {
    final ScanResult r = fresh().selectLocation('L1').applyScan(
          raw: 'MYSTERY-9',
          view: _view(),
          newId: newId,
          now: t0,
        );
    expect(r.outcome, ScanOutcome.lineAdded);
    expect(r.line!.unexpected, isTrue);
    expect(r.line!.serialNo, isNull);
    expect(r.line!.itemId, isNull);
  });

  test('serials: select the item, each unit once, duplicates refused', () {
    final AuditCounterView view = _view();
    CountSession s = fresh().selectLocation('L1');
    final ScanResult pick =
        s.applyScan(raw: '315/80R22.5', view: view, newId: newId, now: t0);
    expect(pick.outcome, ScanOutcome.serialItemSelected);
    s = pick.session;
    final ScanResult one = s.applyScan(
      raw: 'SN-0001',
      view: view,
      newId: newId,
      now: t0.add(const Duration(seconds: 2)),
    );
    expect(one.outcome, ScanOutcome.lineAdded);
    expect(one.line!.serialNo, 'SN-0001');
    expect(one.line!.countedQty, 1);
    expect(one.line!.itemId, 'I-TYRE');
    s = one.session.selectLocation('L2').selectLocation('L1');
    s = s
        .applyScan(
          raw: '315/80R22.5',
          view: view,
          newId: newId,
          now: t0.add(const Duration(seconds: 4)),
        )
        .session;
    final ScanResult dup = s.applyScan(
      raw: ' sn-0001 ',
      view: view,
      newId: newId,
      now: t0.add(const Duration(seconds: 9)),
    );
    expect(dup.outcome, ScanOutcome.duplicateSerial);
    expect(dup.session.lines, hasLength(1));
  });

  test('changing location stops serial scanning', () {
    final CountSession s = fresh()
        .selectLocation('L1')
        .applyScan(raw: '315/80R22.5', view: _view(), newId: newId, now: t0)
        .session;
    expect(s.activeSerialItemId, 'I-TYRE');
    expect(s.selectLocation('L2').activeSerialItemId, isNull);
  });

  group('completeness and zero', () {
    final CountLine base = CountLine(
      clientUuid: 'c1',
      locationId: 'L1',
      scannedCode: 'X',
      countedAt: t0,
    );

    test('an untouched line is not complete', () {
      expect(base.isComplete, isFalse);
    });

    test('zero is only a count when confirmed', () {
      expect(base.copyWith(countedQty: 0).isComplete, isFalse);
      expect(
        base.copyWith(countedQty: 0, confirmedZero: true).isComplete,
        isTrue,
      );
    });

    test('submit payload carries counted_at and no expected quantity', () {
      final Map<String, Object?> json = base.copyWith(
        countedQty: 4,
        photoPaths: <String>['/local/a.jpg'],
      ).toSubmitJson();
      expect(json['counted_qty'], 4);
      expect(json['client_uuid'], 'c1');
      expect(json['counted_at'], t0.toIso8601String());
      expect(json.keys.where(isBlindForbiddenKey), isEmpty);
      expect(json.containsKey('unexpected'), isTrue);
      expect(json.toString(), isNot(contains('/local/a.jpg')));
    });
  });

  test('submitted lines cannot be edited or removed on the phone', () {
    final AuditCounterView view = _view();
    CountSession s = fresh()
        .selectLocation('L1')
        .applyScan(raw: 'FLT-100', view: view, newId: newId, now: t0)
        .session;
    final CountLine line = s.lines.single.copyWith(countedQty: 3);
    s = s.updateLine(line).applySubmitResult(
          const CountSubmitResult(accepted: <String>{'u1'}),
        );
    expect(s.lines.single.state, CountLineState.submitted);
    final CountSession edited = s.updateLine(line.copyWith(countedQty: 99));
    expect(edited.lines.single.countedQty, 3);
    expect(s.removeLine('u1').lines, hasLength(1));
    expect(s.pending, isEmpty);
  });

  test('reconcile returns the same instance when nothing changes', () {
    final CountSession s = fresh();
    expect(identical(s.reconcileWithServer(<String>{'x'}), s), isTrue);
  });

  test('a session survives a JSON round trip (resume after restart)', () {
    final AuditCounterView view = _view();
    final CountSession s = fresh()
        .selectLocation('L1')
        .applyScan(raw: '315/80R22.5', view: view, newId: newId, now: t0)
        .session
        .applyScan(
          raw: 'SN-9',
          view: view,
          newId: newId,
          now: t0.add(const Duration(seconds: 3)),
        )
        .session;
    final CountSession back = CountSession.fromJson(s.toJson());
    expect(back.activeLocationId, 'L1');
    expect(back.activeSerialItemId, 'I-TYRE');
    expect(back.lines.single.serialNo, 'SN-9');
    expect(back.lines.single.countedAt, t0.add(const Duration(seconds: 3)));
  });

  test('progress counts locations, never quantities', () {
    final AuditCounterView view = _view();
    final CountSession s = fresh()
        .selectLocation('L1')
        .applyScan(raw: 'FLT-100', view: view, newId: newId, now: t0)
        .session;
    final CountSession counted =
        s.updateLine(s.lines.single.copyWith(countedQty: 5));
    final CountProgress p = CountProgress.of(counted, view);
    expect(p.locationsTotal, 2);
    expect(p.locationsCounted, 1);
    expect(p.fraction, 0.5);
    expect(p.linesPending, 1);
  });

  test('scan parsing strips wedge control characters and prefixes', () {
    expect(
      parseInventoryScan('\x02TP:LOC:abc\r'),
      const InventoryScan(InventoryScanKind.location, 'abc'),
    );
    expect(
      parseInventoryScan('tp:stk:9'),
      const InventoryScan(InventoryScanKind.stockRow, '9'),
    );
    expect(parseInventoryScan('TP:LOC:'), isNull);
    expect(parseInventoryScan('   '), isNull);
    expect(scanIdentityKey(' ab 12 '), 'AB12');
  });
}
