import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_handover_gating.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 9, 16, 15, 8);

  AccidentDispatch leg({
    String status = 'in_transit',
    DateTime? arrived,
    bool accepted = false,
    DateTime? acceptedAt,
  }) =>
      AccidentDispatch(
        id: 'd1',
        accidentId: 'a1',
        departureAt: DateTime.utc(2026, 9, 16, 14),
        liveStatus: status,
        arrivedAt: arrived,
        custodyAccepted: accepted,
        acceptedAt: acceptedAt,
      );

  group('receiptMissing', () {
    test('an empty draft is missing every asterisked field', () {
      final List<String> missing =
          receiptMissing(const HandoverReceiptDraft().toFieldMap());
      expect(missing, receiptRequired);
    });

    test('a complete draft is missing nothing', () {
      final HandoverReceiptDraft draft = HandoverReceiptDraft(
        arrivedAt: now,
        receivedByName: 'Receiver',
        receivedByDesignation: 'Supervisor',
        receivingPhotos: const <String>['/tmp/a.jpg'],
        handoverPaperRef: '/tmp/paper.jpg',
        receiverSignature: 'data:image/png;base64,AAAA',
        custodyAccepted: true,
      );
      expect(receiptMissing(draft.toFieldMap()), isEmpty);
    });

    test('whitespace names and an unticked checkbox still count as blank',
        () {
      final HandoverReceiptDraft draft = HandoverReceiptDraft(
        arrivedAt: now,
        receivedByName: '   ',
        receivedByDesignation: 'x',
        receivingPhotos: const <String>['p'],
        handoverPaperRef: 'h',
        receiverSignature: 's',
      );
      expect(
        receiptMissing(draft.toFieldMap()),
        <String>['received_by_name', 'custody_accepted'],
      );
    });
  });

  group('canSignAndAccept', () {
    final HandoverReceiptDraft complete = HandoverReceiptDraft(
      arrivedAt: now,
      receivedByName: 'R',
      receivedByDesignation: 'D',
      receivingPhotos: const <String>['p'],
      handoverPaperRef: 'h',
      receiverSignature: 's',
      custodyAccepted: true,
    );

    test('needs a dispatch leg to accept against', () {
      expect(canSignAndAccept(complete), isFalse);
      expect(canSignAndAccept(complete, dispatch: leg()), isTrue);
    });

    test('never re-accepts an already accepted leg', () {
      expect(
        canSignAndAccept(complete, dispatch: leg(accepted: true)),
        isFalse,
      );
    });

    test('an incomplete draft stays disabled', () {
      expect(
        canSignAndAccept(
          complete.copyWith(custodyAccepted: false),
          dispatch: leg(),
        ),
        isFalse,
      );
    });
  });

  group('transitElapsed', () {
    test('runs from departure to now while in transit', () {
      expect(transitElapsed(leg(), now), const Duration(hours: 1, minutes: 8));
      expect(transitTimerRunning(leg()), isTrue);
    });

    test('freezes at the recorded arrival', () {
      final AccidentDispatch d = leg(
        status: 'arrived',
        arrived: DateTime.utc(2026, 9, 16, 14, 30),
      );
      expect(transitElapsed(d, now), const Duration(minutes: 30));
      expect(transitTimerRunning(d), isFalse);
    });

    test('is null when the leg has not left', () {
      expect(transitElapsed(leg(status: 'preparing'), now), isNull);
      expect(transitElapsed(null, now), isNull);
    });
  });

  group('vendorSlaChip', () {
    test('reads Not started until custody is accepted, whatever the SLA', () {
      final VendorSlaSnapshot running = VendorSlaSnapshot(
        state: 'running',
        dueAt: now.add(const Duration(hours: 2)),
      );
      expect(vendorSlaChip(leg(), running, now).label, 'Not started');
      expect(vendorSlaChip(null, running, now).label, 'Not started');
    });

    test('after acceptance the SLA instance decides', () {
      final AccidentDispatch d = leg(accepted: true, acceptedAt: now);
      expect(
        vendorSlaChip(
          d,
          VendorSlaSnapshot(
            state: 'running',
            dueAt: now.add(const Duration(minutes: 52)),
          ),
          now,
        ).label,
        'Due in 52m',
      );
      expect(vendorSlaChip(d, null, now).label, 'Started, no SLA target');
      expect(
        vendorSlaChip(d, const VendorSlaSnapshot(state: 'met'), now).tone,
        VendorSlaTone.ok,
      );
      expect(
        vendorSlaChip(
          d,
          VendorSlaSnapshot(
            state: 'running',
            dueAt: now.subtract(const Duration(minutes: 5)),
          ),
          now,
        ).label,
        'Overdue by 5m',
      );
    });
  });

  group('dispatchStepState', () {
    test('no leg: dispatched is next, the rest pending', () {
      expect(dispatchStepState('dispatched', null), DispatchStepState.next);
      expect(dispatchStepState('arrived', null), DispatchStepState.pending);
      expect(
        dispatchStepState('vendor_assessment', null),
        DispatchStepState.pending,
      );
    });

    test('in transit: dispatched complete, arrived next', () {
      expect(
        dispatchStepState('dispatched', leg()),
        DispatchStepState.complete,
      );
      expect(dispatchStepState('arrived', leg()), DispatchStepState.next);
      expect(
        dispatchStepState('signed_acceptance', leg()),
        DispatchStepState.pending,
      );
    });

    test('accepted: three complete, vendor assessment next', () {
      final AccidentDispatch d = leg(
        status: 'accepted',
        arrived: now,
        accepted: true,
        acceptedAt: now,
      );
      for (final String key in <String>[
        'dispatched',
        'arrived',
        'signed_acceptance',
      ]) {
        expect(dispatchStepState(key, d), DispatchStepState.complete);
      }
      expect(
        dispatchStepState('vendor_assessment', d),
        DispatchStepState.next,
      );
      expect(dispatchStepTime('signed_acceptance', d), now);
    });
  });

  test('formatElapsed uses the mock shapes', () {
    expect(formatElapsed(const Duration(hours: 1, minutes: 8)), '1h 08m');
    expect(formatElapsed(const Duration(days: 4, hours: 6)), '4d 6h');
    expect(formatElapsed(const Duration(minutes: 52)), '52m');
    expect(formatElapsed(const Duration(minutes: -3)), '0m');
  });

  test('fromRow reads jsonb lists, numerics and booleans honestly', () {
    final AccidentDispatch d = AccidentDispatch.fromRow(<String, Object?>{
      'id': 'x',
      'accident_id': 'a',
      'live_status': 'arrived',
      'departure_at': '2026-09-16T14:00:00Z',
      'documents_sent': <Object?>['Registration', 'Insurance card'],
      'outgoing_photos': <Object?>[],
      'out_fuel_pct': '45',
      'keys_count': 2,
      'condition_matches': null,
      'custody_accepted': null,
    });
    expect(d.documentsSent, <String>['Registration', 'Insurance card']);
    expect(d.outFuelPct, 45);
    expect(d.keysCount, 2);
    expect(d.conditionMatches, isNull);
    expect(d.custodyAccepted, isFalse);
    expect(d.hasArrived, isTrue);
    expect(dispatchLiveStateLabel(d.liveStatus), 'Arrived');
  });
}
