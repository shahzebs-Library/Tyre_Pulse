import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/driver_concerns/data/driver_concern_repository.dart';

void main() {
  group('a saved concern belongs to the account that wrote it', () {
    test('the owner survives saving, a failed send and reading back', () {
      final ConcernDraft draft = ConcernDraft(
        category: 'pay',
        subtype: 'late',
        text: 'Salary late',
        lang: 'en',
      ).withOwner('driver-a');
      final ConcernDraft failed = draft.withError('refused: x');
      final ConcernDraft back = ConcernDraft.fromJson(failed.toJson());
      expect(back.ownerId, 'driver-a');
      expect(back.clientUuid, draft.clientUuid);
      expect(back.error, 'refused: x');
    });

    test('an old draft without an owner reads back with no owner', () {
      final ConcernDraft legacy = ConcernDraft.fromJson(<String, Object?>{
        'category': 'pay',
        'subtype': 'late',
        'text': 't',
        'client_uuid': 'u1',
      });
      expect(legacy.ownerId, isNull);
    });
  });
}
