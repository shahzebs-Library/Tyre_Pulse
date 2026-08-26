import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';

void main() {
  group('ScrapMark.fromRow', () {
    test('decodes every column', () {
      final ScrapMark mark = ScrapMark.fromRow(<String, dynamic>{
        'serial': 'EP0604207',
        'reason': 'Worn beyond limit',
        'created_at': '2026-08-01T09:00:00Z',
      });

      expect(mark.serial, 'EP0604207');
      expect(mark.reason, 'Worn beyond limit');
      expect(mark.createdAt, '2026-08-01T09:00:00Z');
    });

    test('reason and created_at are optional', () {
      final ScrapMark mark = ScrapMark.fromRow(<String, dynamic>{
        'serial': 'EP0604207',
      });
      expect(mark.reason, isNull);
      expect(mark.createdAt, isNull);
    });

    test('a blank reason decodes to null, not an empty string', () {
      final ScrapMark mark = ScrapMark.fromRow(<String, dynamic>{
        'serial': 'EP0604207',
        'reason': '   ',
      });
      expect(mark.reason, isNull);
    });

    test('a missing serial decodes to an empty string, never throws', () {
      final ScrapMark mark = ScrapMark.fromRow(<String, dynamic>{});
      expect(mark.serial, '');
    });
  });

  group('equality', () {
    test('two marks with identical fields are equal', () {
      ScrapMark build() => ScrapMark.fromRow(<String, dynamic>{
            'serial': 'EP0604207',
            'reason': 'Worn',
          });
      expect(build(), build());
      expect(build().hashCode, build().hashCode);
    });

    test('a different reason makes two marks unequal', () {
      final ScrapMark a = ScrapMark.fromRow(<String, dynamic>{
        'serial': 'EP0604207',
        'reason': 'Worn',
      });
      final ScrapMark b = ScrapMark.fromRow(<String, dynamic>{
        'serial': 'EP0604207',
        'reason': 'Punctured',
      });
      expect(a, isNot(b));
    });
  });
}
