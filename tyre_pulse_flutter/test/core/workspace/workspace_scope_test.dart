import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

void main() {
  group('the array columns decode as arrays', () {
    test('an empty array grants nothing', () {
      final CountryScope scope = CountryScope.fromJson(const <Object?>[]);
      expect(scope.values, isEmpty);
      expect(scope.isBlank, isTrue);
      expect(scope.canSee('KSA', isSuperAdmin: false), isFalse);
    });

    test('a single value decodes as one entry', () {
      final CountryScope scope = CountryScope.fromJson(const <Object?>['KSA']);
      expect(scope.values, <String>['KSA']);
      expect(scope.canSee('KSA', isSuperAdmin: false), isTrue);
      expect(scope.canSee('UAE', isSuperAdmin: false), isFalse);
    });

    test('several values decode as several entries', () {
      final CountryScope scope =
          CountryScope.fromJson(const <Object?>['KSA', 'UAE']);
      expect(scope.values, <String>['KSA', 'UAE']);
      expect(scope.canSee('KSA', isSuperAdmin: false), isTrue);
      expect(scope.canSee('UAE', isSuperAdmin: false), isTrue);
      expect(scope.canSee('Egypt', isSuperAdmin: false), isFalse);
    });

    test('null decodes as blank, which grants nothing', () {
      // V309 reversed V269: blank means no access, not all access.
      expect(CountryScope.fromJson(null).isBlank, isTrue);
      expect(SiteScope.fromJson(null).isBlank, isTrue);
      expect(
        SiteScope.fromJson(null).canSee(
          'NHC',
          isSuperAdmin: false,
          isAdminRole: false,
        ),
        isFalse,
      );
    });

    test('a bare string is accepted rather than read as no scope', () {
      // Defensive. A client that has already collapsed the array hands over a
      // string, and treating that as "no scope" would black the user out - the
      // exact class of failure the Kotlin build produced by assuming a scalar.
      final CountryScope scope = CountryScope.fromJson('KSA');
      expect(scope.values, <String>['KSA']);
      expect(scope.canSee('KSA', isSuperAdmin: false), isTrue);
    });

    test('non-string elements and blanks are dropped, never stringified', () {
      final CountryScope scope = CountryScope.fromJson(
        const <Object?>['KSA', 42, '', '   ', null, 'UAE'],
      );
      expect(scope.values, <String>['KSA', 'UAE']);
    });

    test('a value that is neither a list nor a string yields blank', () {
      expect(CountryScope.fromJson(42).isBlank, isTrue);
      expect(stringListFromJson(42), isNull);
    });

    test('entries are trimmed', () {
      final SiteScope scope = SiteScope.fromJson(const <Object?>['  NHC  ']);
      expect(scope.values, <String>['NHC']);
    });
  });

  group('country sentinel', () {
    test('all, All and ALL are the sentinel', () {
      for (final String sentinel in <String>['all', 'All', 'ALL', ' aLl ']) {
        final CountryScope scope =
            CountryScope.fromJson(<Object?>[sentinel]);
        expect(scope.seesAllCountries, isTrue, reason: 'failed on $sentinel');
        expect(scope.canSee('Egypt', isSuperAdmin: false), isTrue);
      }
    });

    test('a star is NOT a country sentinel - trap T2', () {
      // The SQL compares lower(btrim(x)) = 'all'. A star is a site-only
      // sentinel, and in a country array it is a country name matching nothing.
      final CountryScope scope = CountryScope.fromJson(const <Object?>['*']);
      expect(scope.seesAllCountries, isFalse);
      expect(scope.canSee('KSA', isSuperAdmin: false), isFalse);
    });

    test('named countries exclude the sentinel', () {
      final CountryScope scope =
          CountryScope.fromJson(const <Object?>['All', 'KSA']);
      expect(scope.namedCountries, <String>['KSA']);
      expect(scope.seesAllCountries, isTrue);
    });

    test('matching ignores case and padding', () {
      final CountryScope scope = CountryScope.fromJson(const <Object?>['ksa']);
      expect(scope.canSee('  KSA ', isSuperAdmin: false), isTrue);
    });
  });

  group('site sentinel', () {
    test('ALL and star are both sentinels, in any casing', () {
      for (final String sentinel in <String>['ALL', 'all', 'All', '*', ' * ']) {
        final SiteScope scope = SiteScope.fromJson(<Object?>[sentinel]);
        expect(scope.isOrganisationWide, isTrue, reason: 'failed on $sentinel');
        expect(
          scope.canSee('NHC', isSuperAdmin: false, isAdminRole: false),
          isTrue,
        );
      }
    });

    test('named sites exclude the sentinels', () {
      final SiteScope scope =
          SiteScope.fromJson(const <Object?>['ALL', 'NHC', '*']);
      expect(scope.namedSites, <String>['NHC']);
    });

    test('a named scope admits only its own sites', () {
      final SiteScope scope = SiteScope.fromJson(const <Object?>['NHC']);
      expect(
        scope.canSee('nhc', isSuperAdmin: false, isAdminRole: false),
        isTrue,
      );
      expect(
        scope.canSee('DIRIYAH', isSuperAdmin: false, isAdminRole: false),
        isFalse,
      );
    });
  });

  group('a row with no scope value is visible to everyone', () {
    test('a null country is visible even to a blank scope', () {
      // Deliberate in the SQL, and the reason every client-side country filter
      // must be null-safe. RECORDED: a strict equality filter on work_orders
      // hid 55,606 country-less job cards from every country view.
      expect(CountryScope.none.canSee(null, isSuperAdmin: false), isTrue);
    });

    test('a null or blank site is visible even to a blank scope', () {
      expect(
        SiteScope.none.canSee(null, isSuperAdmin: false, isAdminRole: false),
        isTrue,
      );
      expect(
        SiteScope.none.canSee('   ', isSuperAdmin: false, isAdminRole: false),
        isTrue,
      );
    });
  });

  group('who is exempt - trap T3', () {
    test('a super-admin bypasses both scopes', () {
      expect(CountryScope.none.canSee('UAE', isSuperAdmin: true), isTrue);
      expect(
        SiteScope.none.canSee('NHC', isSuperAdmin: true, isAdminRole: false),
        isTrue,
      );
    });

    test('a plain Admin bypasses SITE but not COUNTRY', () {
      // After V558 the country helper dropped its org-admin term, which had
      // let a plain organisation Admin cross every country. The site helper
      // still carries role = Admin. RECORDED: zero plain Admins exist today,
      // so the asymmetry is latent - which is how it would be lost in a
      // rewrite.
      final CountryScope countries =
          CountryScope.fromJson(const <Object?>['KSA']);
      final SiteScope sites = SiteScope.fromJson(const <Object?>['NHC']);

      expect(countries.canSee('UAE', isSuperAdmin: false), isFalse);
      expect(
        sites.canSee('DIRIYAH', isSuperAdmin: false, isAdminRole: true),
        isTrue,
      );
    });
  });

  group('value semantics', () {
    test('two scopes with the same values are equal', () {
      expect(
        CountryScope.fromJson(const <Object?>['KSA']),
        CountryScope.fromJson(const <Object?>['KSA']),
      );
      expect(
        CountryScope.fromJson(const <Object?>['KSA']).hashCode,
        CountryScope.fromJson(const <Object?>['KSA']).hashCode,
      );
    });

    test('a country scope never equals a site scope with the same values', () {
      expect(
        CountryScope.fromJson(const <Object?>['ALL']),
        isNot(SiteScope.fromJson(const <Object?>['ALL'])),
      );
    });

    test('order matters, because the stored order is preserved', () {
      expect(
        CountryScope.fromJson(const <Object?>['KSA', 'UAE']),
        isNot(CountryScope.fromJson(const <Object?>['UAE', 'KSA'])),
      );
    });

    test('the values list is unmodifiable', () {
      final CountryScope scope = CountryScope.fromJson(const <Object?>['KSA']);
      expect(() => scope.values.add('UAE'), throwsUnsupportedError);
    });
  });
}
