import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/search/domain/search_identifiers.dart';

void main() {
  group('isUuidLike', () {
    test('accepts a canonical lowercase uuid', () {
      expect(
        isUuidLike('550e8400-e29b-41d4-a716-446655440000'),
        isTrue,
      );
    });

    test('accepts an uppercase uuid - hex case is not the shape signal', () {
      expect(
        isUuidLike('550E8400-E29B-41D4-A716-446655440000'),
        isTrue,
      );
    });

    test('trims surrounding whitespace before checking the shape', () {
      expect(
        isUuidLike('  550e8400-e29b-41d4-a716-446655440000  '),
        isTrue,
      );
    });

    test('refuses a plain asset number', () {
      expect(isUuidLike('TM514'), isFalse);
    });

    test('refuses a tyre serial', () {
      expect(isUuidLike('EP0604207'), isFalse);
    });

    test('refuses a uuid missing one dash group', () {
      expect(isUuidLike('550e8400-e29b-41d4-446655440000'), isFalse);
    });

    test('refuses a uuid with a non-hex character', () {
      expect(isUuidLike('550e8400-e29b-41d4-a716-44665544000g'), isFalse);
    });

    test('refuses a blank string', () {
      expect(isUuidLike(''), isFalse);
      expect(isUuidLike('   '), isFalse);
    });
  });

  group('escapeLikePattern', () {
    test('leaves an ordinary term untouched', () {
      expect(escapeLikePattern('TM514'), 'TM514');
    });

    test('escapes a percent sign so it cannot widen the match', () {
      // Without escaping, a literal "%" in a typed term becomes the SQL
      // wildcard and turns a narrow search into a match-everything scan -
      // the exact class of defect this function exists to prevent (see its
      // own doc comment on `searchFilter.js`'s `escapeLike`).
      expect(escapeLikePattern('50%'), r'50\%');
    });

    test('escapes an underscore so it cannot match any single character', () {
      expect(escapeLikePattern('WO_123'), r'WO\_123');
    });

    test(
        'escapes a literal backslash before the characters it introduces '
        'depend on it', () {
      expect(escapeLikePattern(r'A\B'), r'A\\B');
    });

    test(
        'escapes a backslash before a later percent, in the right order '
        'so the backslash cannot accidentally un-escape the percent', () {
      // If the backslash were escaped AFTER the percent, a term of
      // "A\%B" would produce "A\\%B" only by coincidence of ordering -
      // this pins the actual replacement order the implementation uses.
      expect(escapeLikePattern(r'A\%B'), r'A\\\%B');
    });

    test('escapes every occurrence, not just the first', () {
      expect(escapeLikePattern('%%__'), r'\%\%\_\_');
    });

    test('an empty string stays empty', () {
      expect(escapeLikePattern(''), '');
    });
  });
}
