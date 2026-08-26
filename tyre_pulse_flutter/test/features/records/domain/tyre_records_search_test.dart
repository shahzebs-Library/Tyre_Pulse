/// Search-term escaping, ported from `escapeLike` / `orIlike` in
/// `mobile/lib/queryFilters.ts`.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/records/domain/tyre_records_search.dart';

void main() {
  group('escapeLikeTerm', () {
    test('keeps an ordinary term unchanged', () {
      expect(escapeLikeTerm('TM514'), 'TM514');
    });

    test('strips the PostgREST .or() delimiters comma and parentheses', () {
      expect(escapeLikeTerm('a,b(c)'), 'abc');
    });

    test(
        'strips ilike pattern metacharacters percent, underscore and '
        'backslash', () {
      expect(escapeLikeTerm(r'%foo_bar\baz'), 'foobarbaz');
    });

    test('strips the informal asterisk wildcard too', () {
      expect(escapeLikeTerm('TM*514'), 'TM514');
    });

    test(
        'keeps hyphens, dots and single spaces - real in asset numbers '
        'and serials', () {
      expect(escapeLikeTerm('TM-514.A test'), 'TM-514.A test');
    });

    test('collapses runs of whitespace to one space', () {
      expect(escapeLikeTerm('TM   514'), 'TM 514');
    });

    test('trims leading and trailing whitespace', () {
      expect(escapeLikeTerm('  TM514  '), 'TM514');
    });

    test('a blank or whitespace-only term becomes empty', () {
      expect(escapeLikeTerm(''), '');
      expect(escapeLikeTerm('   '), '');
    });

    test('caps length at kMaxSearchTermLength', () {
      final String long = 'a' * (kMaxSearchTermLength + 50);
      expect(escapeLikeTerm(long).length, kMaxSearchTermLength);
    });

    test('is idempotent: escaping an already-escaped term is a no-op', () {
      const String raw = r'a,b(c)%d_e\f*g';
      final String once = escapeLikeTerm(raw);
      final String twice = escapeLikeTerm(once);
      expect(twice, once);
    });
  });

  group('orIlikeFilter', () {
    const List<String> columns = <String>['asset_no', 'serial_no', 'brand'];

    test('builds a comma-joined ilike expression across every column', () {
      expect(
        orIlikeFilter(columns, 'TM514'),
        'asset_no.ilike.%TM514%,serial_no.ilike.%TM514%,brand.ilike.%TM514%',
      );
    });

    test('escapes the term before building the expression', () {
      expect(orIlikeFilter(<String>['asset_no'], 'a,b'), 'asset_no.ilike.%ab%');
    });

    test('returns null for a blank term rather than an empty filter', () {
      expect(orIlikeFilter(columns, ''), isNull);
      expect(orIlikeFilter(columns, '   '), isNull);
    });

    test('returns null for a term that escapes to nothing', () {
      // A search box holding only PostgREST-significant characters must
      // not become a filter that matches every row.
      expect(orIlikeFilter(columns, ',(),'), isNull);
    });

    test('returns null when no columns are given', () {
      expect(orIlikeFilter(const <String>[], 'TM514'), isNull);
    });

    test('drops an empty column name rather than emitting ".ilike."', () {
      expect(
        orIlikeFilter(<String>['asset_no', ''], 'TM514'),
        'asset_no.ilike.%TM514%',
      );
    });
  });
}
