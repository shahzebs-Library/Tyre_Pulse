library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';

void main() {
  group('TyreRecordsQuery.effectiveSite', () {
    test('is the explicit site when one is chosen', () {
      const TyreRecordsQuery query = TyreRecordsQuery(
        site: 'NHC',
        restrictToSite: 'DIRIYAH',
      );
      expect(query.effectiveSite, 'NHC');
    });

    test('falls back to the scope restriction when nothing was chosen', () {
      const TyreRecordsQuery query = TyreRecordsQuery(
        restrictToSite: 'DIRIYAH',
      );
      expect(query.effectiveSite, 'DIRIYAH');
    });

    test('is null when neither is set', () {
      const TyreRecordsQuery query = TyreRecordsQuery();
      expect(query.effectiveSite, isNull);
    });
  });

  group('TyreRecordsQuery.activeFilterCount', () {
    test('is zero with nothing chosen', () {
      expect(const TyreRecordsQuery().activeFilterCount, 0);
      expect(const TyreRecordsQuery().hasActiveFilters, isFalse);
    });

    test('counts an explicit site', () {
      expect(const TyreRecordsQuery(site: 'NHC').activeFilterCount, 1);
    });

    test('counts an explicit risk level', () {
      expect(
        const TyreRecordsQuery(riskLevel: 'Critical').activeFilterCount,
        1,
      );
    });

    test('counts both together', () {
      expect(
        const TyreRecordsQuery(
          site: 'NHC',
          riskLevel: 'Critical',
        ).activeFilterCount,
        2,
      );
    });

    test('never counts restrictToSite - it is scope, not a chosen filter', () {
      expect(
        const TyreRecordsQuery(restrictToSite: 'DIRIYAH').activeFilterCount,
        0,
      );
    });

    test('never counts country or search', () {
      expect(
        const TyreRecordsQuery(
          country: 'KSA',
          search: 'TM514',
        ).activeFilterCount,
        0,
      );
    });
  });

  group('TyreRecordsQuery.copyWith', () {
    test('replaces a field without touching the others', () {
      const TyreRecordsQuery base = TyreRecordsQuery(
        search: 'a',
        site: 'NHC',
        riskLevel: 'Low',
      );
      final TyreRecordsQuery next = base.copyWith(search: 'b');
      expect(next.search, 'b');
      expect(next.site, 'NHC');
      expect(next.riskLevel, 'Low');
    });

    test('a clear flag wins over a null default, actually clearing the '
        'field', () {
      const TyreRecordsQuery base = TyreRecordsQuery(site: 'NHC');
      final TyreRecordsQuery cleared = base.copyWith(clearSite: true);
      expect(cleared.site, isNull);
    });

    test('clearing one field leaves the others untouched', () {
      const TyreRecordsQuery base = TyreRecordsQuery(
        site: 'NHC',
        riskLevel: 'Low',
      );
      final TyreRecordsQuery cleared = base.copyWith(clearSite: true);
      expect(cleared.site, isNull);
      expect(cleared.riskLevel, 'Low');
    });
  });

  group('TyreRecordsQuery.clearChosenFilters', () {
    test('clears site and risk level only', () {
      const TyreRecordsQuery base = TyreRecordsQuery(
        search: 'TM514',
        site: 'NHC',
        riskLevel: 'Critical',
        country: 'KSA',
        restrictToSite: 'DIRIYAH',
      );
      final TyreRecordsQuery cleared = base.clearChosenFilters();
      expect(cleared.site, isNull);
      expect(cleared.riskLevel, isNull);
      // "Clear filters" is not "start over": search, country and the
      // workspace scope restriction are untouched.
      expect(cleared.search, 'TM514');
      expect(cleared.country, 'KSA');
      expect(cleared.restrictToSite, 'DIRIYAH');
    });
  });

  group('equality', () {
    test('two queries with the same fields are equal', () {
      const TyreRecordsQuery a = TyreRecordsQuery(search: 'x', site: 'NHC');
      const TyreRecordsQuery b = TyreRecordsQuery(search: 'x', site: 'NHC');
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a query that differs by one field is not equal', () {
      const TyreRecordsQuery a = TyreRecordsQuery(search: 'x');
      const TyreRecordsQuery b = TyreRecordsQuery(search: 'y');
      expect(a, isNot(equals(b)));
    });

    test('the default constructor is stable and comparable', () {
      expect(const TyreRecordsQuery(), const TyreRecordsQuery());
    });
  });
}
