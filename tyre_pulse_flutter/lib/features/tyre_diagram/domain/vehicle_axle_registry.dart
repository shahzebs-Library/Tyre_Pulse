/// Per-machine axle counts, so a vehicle type with more than one build draws
/// the build that is actually in the yard.
///
/// Today one type needs it: concrete pumps come as 5-axle (14 tyres) and
/// 4-axle (12 tyres). The fleet register records each machine's count in
/// `vehicle_fleet.axle_count` (migration
/// `supabase/migrations/20261103140000_vehicle_fleet_axle_count.sql`); the
/// fleet repository feeds every row it reads into [registerFleetAxleRows].
///
/// Mirrors the web resolver `src/lib/vehicleTyreLayout.js` (`setAxleCounts`
/// / `layoutForAsset`). The same asset code can exist in two countries as two
/// different machines, so an asset is resolved without a country only when
/// every row seen for it agrees; otherwise the registry's preferred country
/// (the one the fleet was last loaded for) decides, and failing that the
/// type's default build is drawn. A machine the registry has never seen
/// always gets the default build - never a guessed one.
library;

/// Layout key -> axle count -> the variant layout key.
const Map<String, Map<int, String>> kAxleVariants = <String, Map<int, String>>{
  'Concrete pump': <int, String>{4: 'Concrete pump 4-axle'},
};

final Map<String, int?> _byCountryAsset = <String, int?>{};
final Map<String, Set<int?>> _byAsset = <String, Set<int?>>{};
String? _preferredCountry;

String _norm(String? s) => (s ?? '').trim().toUpperCase();

int? _count(Object? v) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v.trim());
  return null;
}

/// Records the axle count of each fleet row (`asset_no`, `country`,
/// `axle_count`). Rows with no count are recorded too: knowing a machine has
/// no recorded count is what stops a same-numbered machine abroad borrowing
/// another country's build.
void registerFleetAxleRows(
  Iterable<Map<String, dynamic>> rows, {
  String? country,
}) {
  if (country != null && country.trim().isNotEmpty) {
    _preferredCountry = _norm(country);
  }
  for (final Map<String, dynamic> row in rows) {
    final String asset = _norm(row['asset_no'] as String?);
    if (asset.isEmpty) continue;
    final String c = _norm(row['country'] as String?);
    final int? n = _count(row['axle_count']);
    _byCountryAsset['$c|$asset'] = n;
    (_byAsset[asset] ??= <int?>{}).add(n);
  }
}

/// The recorded axle count for [assetNo], or null when unknown or ambiguous.
int? axleCountFor(String? assetNo, [String? country]) {
  final String asset = _norm(assetNo);
  if (asset.isEmpty) return null;
  final String c = _norm(country);
  if (c.isNotEmpty && _byCountryAsset.containsKey('$c|$asset')) {
    return _byCountryAsset['$c|$asset'];
  }
  final Set<int?>? seen = _byAsset[asset];
  if (seen == null || seen.isEmpty) return null;
  if (seen.length == 1) return seen.first;
  final String? p = _preferredCountry;
  if (p != null && _byCountryAsset.containsKey('$p|$asset')) {
    return _byCountryAsset['$p|$asset'];
  }
  return null;
}

/// The layout key for this machine: [baseKey], or its build variant when the
/// fleet register records a different axle count.
String layoutForAsset(String baseKey, String? assetNo, [String? country]) {
  final Map<int, String>? variants = kAxleVariants[baseKey];
  if (variants == null) return baseKey;
  final int? n = axleCountFor(assetNo, country);
  return (n == null ? null : variants[n]) ?? baseKey;
}

/// Test seam: forget everything registered.
void resetAxleRegistryForTest() {
  _byCountryAsset.clear();
  _byAsset.clear();
  _preferredCountry = null;
}

/// Everything the registry knows, as `'COUNTRY|ASSET' -> count` (null =
/// known machine, no recorded count). Persisted so a phone that restarts with
/// no signal still draws each machine's own build.
Map<String, int?> exportAxleRegistry() =>
    Map<String, int?>.unmodifiable(_byCountryAsset);

/// The preferred country last set by a fleet load, for persistence.
String? get preferredAxleCountry => _preferredCountry;

/// Restores a saved snapshot. Entries learnt live this session win: a saved
/// value never overwrites what the server has just said.
void importAxleRegistry(Map<String, int?> saved, {String? preferredCountry}) {
  saved.forEach((String key, int? n) {
    final int bar = key.indexOf('|');
    if (bar < 0) return;
    final String asset = key.substring(bar + 1);
    if (asset.isEmpty || _byCountryAsset.containsKey(key)) return;
    _byCountryAsset[key] = n;
    (_byAsset[asset] ??= <int?>{}).add(n);
  });
  if (_preferredCountry == null &&
      preferredCountry != null &&
      preferredCountry.trim().isNotEmpty) {
    _preferredCountry = _norm(preferredCountry);
  }
}
