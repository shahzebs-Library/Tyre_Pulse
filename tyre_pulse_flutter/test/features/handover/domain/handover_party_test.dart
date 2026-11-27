import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/handover/domain/handover_party.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';

HandoverRecord _record(Map<String, Object?> row) =>
    HandoverRecord.fromRow(<String, Object?>{
      'id': 'h1',
      'asset_no': 'TM655',
      'approval_status': 'pending_supervisor',
      ...row,
    });

void main() {
  test('creator, signature collector and linked driver are parties', () {
    final HandoverRecord r = _record(<String, Object?>{
      'created_by': 'u-creator',
      'from_signed_by': 'u-from',
      'to_signed_by': 'u-to',
      'from_driver_id': 'd-from',
      'to_driver_id': 'd-to',
      'to_signed_at': '2026-11-27T08:00:00Z',
    });
    expect(
      handoverPartyReason(r, userId: 'u-creator'),
      HandoverPartyReason.created,
    );
    expect(
      handoverPartyReason(r, userId: 'u-from'),
      HandoverPartyReason.collectedSignature,
    );
    expect(
      handoverPartyReason(r, userId: 'u-to'),
      HandoverPartyReason.collectedSignature,
    );
    expect(
      handoverPartyReason(r, userId: 'u-x', linkedDriverId: 'd-to'),
      HandoverPartyReason.isDriver,
    );
    expect(handoverPartyReason(r, userId: 'u-independent'), isNull);
  });

  test('notice exists in every language', () {
    for (final String lang in <String>['en', 'ar', 'ur', 'fr']) {
      for (final HandoverPartyReason reason in HandoverPartyReason.values) {
        expect(handoverPartyNotice(lang, reason), isNotEmpty);
      }
    }
  });
}
