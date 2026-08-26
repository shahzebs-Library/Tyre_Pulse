/// The active filter state for the tyre records register.
///
/// Ported from the four independent pieces of filter state the production
/// screen keeps (`search`, `siteFilter`, `riskFilter`, plus the implicit
/// country/own-site scope), folded into one immutable, comparable value so
/// the controller can detect "did the effective query actually change" with
/// a plain `==` rather than re-deriving that from four separate fields.
///
/// [country] and [restrictToSite] are NOT user-chosen filters. They come
/// from the active workspace: [country] is the null-safe country scope
/// (`WorkspaceContext.activeCountry`), and [restrictToSite] is the
/// production screen's own fallback rule - "inspector / tyre_man / reporter
/// -> own site only" - now applied to whichever non-administrator holds an
/// explicit per-user grant to this admin-only module, since nobody else can
/// reach the screen at all. [restrictToSite] is used ONLY when [site] itself
/// is null: an explicit filter choice always wins over the scope fallback.
library;

import 'package:flutter/foundation.dart';

@immutable
final class TyreRecordsQuery {
  const TyreRecordsQuery({
    this.search = '',
    this.site,
    this.riskLevel,
    this.country,
    this.restrictToSite,
  });

  /// The debounced search text. Matched against asset number, serial number
  /// and brand - see `tyre_records_search.dart`.
  final String search;

  /// An explicit site chosen in the filter sheet. Null means no site filter
  /// was chosen, which is not the same as "no site scoping applies" - see
  /// [effectiveSite].
  final String? site;

  /// One of `Critical`, `High`, `Medium`, `Low`, or null for no risk filter.
  final String? riskLevel;

  /// The workspace's null-safe active country, or null for every country the
  /// user's own scope already permits.
  final String? country;

  /// The workspace's legacy `profiles.site` scalar, applied only when [site]
  /// is null. See the library comment.
  final String? restrictToSite;

  /// The site a fetch should actually filter by: the explicit choice, else
  /// the scope fallback, else no site filter at all.
  String? get effectiveSite => site ?? restrictToSite;

  /// How many filter CHIPS should be shown as active. [restrictToSite]
  /// deliberately does not count here: it is not a filter the person chose
  /// and clearing it is not something the filter sheet's "Clear filters"
  /// offers.
  int get activeFilterCount =>
      (site != null ? 1 : 0) + (riskLevel != null ? 1 : 0);

  bool get hasActiveFilters => activeFilterCount > 0;

  TyreRecordsQuery copyWith({
    String? search,
    String? site,
    bool clearSite = false,
    String? riskLevel,
    bool clearRiskLevel = false,
    String? country,
    bool clearCountry = false,
    String? restrictToSite,
    bool clearRestrictToSite = false,
  }) {
    return TyreRecordsQuery(
      search: search ?? this.search,
      site: clearSite ? null : (site ?? this.site),
      riskLevel: clearRiskLevel ? null : (riskLevel ?? this.riskLevel),
      country: clearCountry ? null : (country ?? this.country),
      restrictToSite: clearRestrictToSite
          ? null
          : (restrictToSite ?? this.restrictToSite),
    );
  }

  /// Clears only the filters a person can clear from the filter sheet:
  /// [site] and [riskLevel]. [search], [country] and [restrictToSite] are
  /// untouched - "Clear filters" is not "start over".
  TyreRecordsQuery clearChosenFilters() =>
      copyWith(clearSite: true, clearRiskLevel: true);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TyreRecordsQuery &&
          other.search == search &&
          other.site == site &&
          other.riskLevel == riskLevel &&
          other.country == country &&
          other.restrictToSite == restrictToSite;

  @override
  int get hashCode =>
      Object.hash(search, site, riskLevel, country, restrictToSite);

  @override
  String toString() =>
      'TyreRecordsQuery(search: "$search", site: $site, '
      'risk: $riskLevel, country: $country, restrictToSite: $restrictToSite)';
}
