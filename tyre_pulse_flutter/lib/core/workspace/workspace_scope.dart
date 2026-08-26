/// Country and site scope: the two ARRAY columns on `profiles`.
///
/// # The type trap this file exists for
///
/// `profiles.country` is `text[]`. `profiles.sites` is `text[]`. The Kotlin
/// rebuild treated `country` as a String and **that broke login for most
/// users** - spec section 6 and AGENTS.md both name it as the example of why a
/// column type is verified and never guessed. The proof it is an array is in
/// the SQL: `unnest(pr.country)` and `cardinality(pr.country)` appear in V309,
/// V396 and V558.
///
/// There is also a THIRD column, `profiles.site`, singular, `text`. That is the
/// LEGACY scalar. The production phone reads it to pre-fill a form and to label
/// a header, and it is NOT the access-control scope. Do not conflate the two;
/// [WorkspaceScope] deliberately has no place for it, and the legacy value is
/// carried separately on the profile.
///
/// # Blank means NO access, not ALL access
///
/// V269's header says "NULL/empty = ALL sites". V309 REVERSED that: blank
/// grants nothing, and organisation-wide has to be the explicit sentinel.
/// V309 backfilled every blank `sites` to `ARRAY['ALL']` so nobody was blacked
/// out on the day it shipped. V269's header is still in the repository saying
/// the old rule. **The later file wins.**
///
/// # The two sentinels are not the same sentinel
///
/// Trap T2 in artifact 04 section 5.4:
///
/// | Scope | SQL comparison | Sentinels that work |
/// |---|---|---|
/// | Country | `lower(btrim(x)) = 'all'` | `all`, `All`, `ALL` |
/// | Site | `upper(btrim(s)) in ('ALL','*')` | `all`, `All`, `ALL`, `*` |
///
/// So `'All'` works for both, and `'*'` is a SITE-only sentinel: put it in
/// `country` and it is a country name that matches nothing. That is why there
/// is no single shared sentinel helper here.
///
/// # And they disagree about who is exempt
///
/// Trap T3. After V558, country is bypassed by `is_super_admin()` ALONE - V558
/// removed the `app_is_org_admin()` term, which had let a plain organisation
/// Admin cross every country. Site is still bypassed by `role = 'Admin'` as
/// well, in both `app_can_see_site` (V309) and `app_sees_all_sites` (V396). So
/// a plain Admin sees every SITE and not every COUNTRY. RECORDED: zero plain
/// Admins exist today, so the asymmetry is latent - which is exactly how it
/// would be lost in a rewrite.
///
/// # These are conveniences. RLS is the boundary.
///
/// Every check here mirrors a SQL function so the client can filter and
/// explain. None of it is a security control. The three RESTRICTIVE layers -
/// organisation, country, site - AND together on the server and cannot be
/// widened by anything a client does.
library;

/// Reads a `text[]` column out of a decoded JSON row.
///
/// Accepts a list, a bare string, or null. The bare-string case is defensive:
/// it is what a client that has already collapsed the array hands over, and
/// mistaking that for "no scope" would black the user out. Non-string elements
/// are DROPPED rather than stringified - a number in a country array is
/// corrupt data, not a country.
List<String>? stringListFromJson(Object? raw) {
  if (raw == null) {
    return null;
  }
  if (raw is String) {
    return <String>[raw];
  }
  if (raw is Iterable<Object?>) {
    return raw.whereType<String>().toList(growable: false);
  }
  return null;
}

/// Shared behaviour of the two array scopes.
abstract base class WorkspaceScope {
  const WorkspaceScope(this.values);

  /// The stored entries, trimmed of blanks, in the order the column held them.
  ///
  /// Blank entries are dropped because they can never match anything: the SQL
  /// counts them toward `cardinality` but `lower(btrim(''))` matches no real
  /// country or site name, so dropping them changes no outcome and makes
  /// [isBlank] mean what it says.
  final List<String> values;

  /// True when this scope grants NOTHING. V309.
  bool get isBlank => values.isEmpty;

  /// True when the column carried at least one entry.
  bool get isConfigured => values.isNotEmpty;

  static List<String> cleanValues(Iterable<String>? raw) {
    if (raw == null) {
      return const <String>[];
    }
    final List<String> cleaned = <String>[];
    for (final String value in raw) {
      final String trimmed = value.trim();
      if (trimmed.isNotEmpty) {
        cleaned.add(trimmed);
      }
    }
    return List<String>.unmodifiable(cleaned);
  }

  /// Value equality, so a rebuilt workspace that resolves to the same scope
  /// does not look like a change to a provider watching it.
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) {
      return true;
    }
    if (other is! WorkspaceScope || other.runtimeType != runtimeType) {
      return false;
    }
    if (other.values.length != values.length) {
      return false;
    }
    for (int i = 0; i < values.length; i++) {
      if (other.values[i] != values[i]) {
        return false;
      }
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(runtimeType, Object.hashAll(values));
}

/// `profiles.country`, a `text[]`.
///
/// Mirrors `app_can_see_country` as it stands after V558.
final class CountryScope extends WorkspaceScope {
  const CountryScope._(super.values);

  /// From the already-decoded array.
  factory CountryScope.fromValues(Iterable<String>? raw) =>
      CountryScope._(WorkspaceScope.cleanValues(raw));

  /// From a raw JSON value, which may be a list, a bare string, or null.
  factory CountryScope.fromJson(Object? raw) =>
      CountryScope.fromValues(stringListFromJson(raw));

  /// No countries. Grants nothing (V309).
  static const CountryScope none = CountryScope._(<String>[]);

  /// The only sentinel country scope understands, compared LOWERCASE.
  /// `'*'` is not one; see the library comment, trap T2.
  static const String allSentinel = 'all';

  /// True when the scope carries the `all` sentinel in any casing.
  bool get seesAllCountries => values.any(
        (String value) => value.trim().toLowerCase() == allSentinel,
      );

  /// The named countries, sentinel removed. Empty when the user is scoped to
  /// everything, because "everything" is not a list this client can enumerate -
  /// the set of countries in the platform is server data, not a constant.
  List<String> get namedCountries => List<String>.unmodifiable(
        values.where(
          (String value) => value.trim().toLowerCase() != allSentinel,
        ),
      );

  /// Whether a row stamped [country] is visible.
  ///
  /// - A row whose `country` is NULL is visible to EVERYONE. That is deliberate
  ///   in the SQL and it is why every client-side country filter must be
  ///   written null-safe (`country.eq.X,country.is.null`). RECORDED: a strict
  ///   `.eq` on `work_orders` hid 55,606 country-less job cards from every
  ///   country view.
  /// - Only a super-admin bypasses. A plain Admin does not (V558).
  /// - A blank scope grants nothing (V309).
  bool canSee(String? country, {required bool isSuperAdmin}) {
    if (country == null) {
      return true;
    }
    if (isSuperAdmin) {
      return true;
    }
    if (isBlank) {
      return false;
    }
    final String target = country.trim().toLowerCase();
    return values.any((String value) {
      final String entry = value.trim().toLowerCase();
      return entry == allSentinel || entry == target;
    });
  }

  @override
  String toString() => 'CountryScope($values)';
}

/// `profiles.sites`, a `text[]`.
///
/// Mirrors `app_can_see_site` (V309) and `app_sees_all_sites` (V396). Site
/// isolation is SELECT-only: V269 added RESTRICTIVE site policies to 21
/// operational tables for reads, and writes are not site-gated.
final class SiteScope extends WorkspaceScope {
  const SiteScope._(super.values);

  factory SiteScope.fromValues(Iterable<String>? raw) =>
      SiteScope._(WorkspaceScope.cleanValues(raw));

  factory SiteScope.fromJson(Object? raw) =>
      SiteScope.fromValues(stringListFromJson(raw));

  /// No sites. Grants nothing (V309).
  static const SiteScope none = SiteScope._(<String>[]);

  /// Organisation-wide sentinels, compared UPPERCASE. Unlike country, `'*'`
  /// counts here.
  static const Set<String> allSentinels = <String>{'ALL', '*'};

  /// True when the scope is organisation-wide.
  bool get isOrganisationWide => values.any(
        (String value) => allSentinels.contains(value.trim().toUpperCase()),
      );

  /// The named sites, sentinels removed.
  List<String> get namedSites => List<String>.unmodifiable(
        values.where(
          (String value) => !allSentinels.contains(value.trim().toUpperCase()),
        ),
      );

  /// Whether a row stamped [site] is visible.
  ///
  /// - A null or blank site is visible to everyone, matching
  ///   `p_site is null or btrim(p_site) = ''`.
  /// - A super-admin bypasses, and so does the hard `Admin` ROLE. That second
  ///   exemption does not exist on country. See trap T3.
  /// - A blank scope grants nothing (V309).
  bool canSee(
    String? site, {
    required bool isSuperAdmin,
    required bool isAdminRole,
  }) {
    if (site == null || site.trim().isEmpty) {
      return true;
    }
    if (isSuperAdmin || isAdminRole) {
      return true;
    }
    if (isBlank) {
      return false;
    }
    final String target = site.trim().toUpperCase();
    return values.any((String value) {
      final String entry = value.trim().toUpperCase();
      return allSentinels.contains(entry) || entry == target;
    });
  }

  @override
  String toString() => 'SiteScope($values)';
}
