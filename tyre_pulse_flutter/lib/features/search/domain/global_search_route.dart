import 'package:tyre_pulse/app/router/routes.dart';

/// The route this feature's own search screen would live at, once a human
/// finishes the wiring `lib/app/router/routes.dart` and
/// `lib/app/router/app_router.dart` can only be done by hand-editing those
/// two forbidden files - see this feature's top-level report for the exact
/// steps.
///
/// # Why this class exists at all, given it is never reachable today
///
/// [TpRoute] is a public class this feature is allowed to import
/// read-only and EXTEND in its own file - subclassing a forbidden file's
/// public export in code this feature owns is not "editing" that file, the
/// same way importing `VehiclesRoute`'s type is not editing `routes.dart`.
/// So the route can be fully authored now, structurally complete, and it
/// becomes live the moment a human adds three things to the forbidden
/// files: a `TpRouteId.globalSearch` constant, a matching
/// `TpRoutePaths.globalSearch` constant, and one `GoRoute` entry whose
/// `pathParameters`/`parse` call mirrors [GlobalSearchRoute.parse] below.
/// Until then this class is dead code from the router's point of view -
/// `screen_registry.dart`'s lookup is keyed on `route.routeId`, and nothing
/// in the real router can ever produce a [GlobalSearchRoute] instance to
/// look up, exactly as `app/router/screen_registry.dart` documents for any
/// route with no matching `GoRoute`.
///
/// # The placeholder id/path
///
/// [_placeholderRouteId] and [_placeholderPath] are LOCAL to this file -
/// they are not, and cannot be, entries on the real `TpRouteId`/
/// `TpRoutePaths` classes (both forbidden). A human wiring this in should
/// replace every use of them with real constants added to those two
/// classes, not copy these string literals verbatim, so that the eventual
/// `TpRouteId.globalSearch` lives in the one place every other route's id
/// already lives.
const String _placeholderRouteId = 'globalSearch';
const String _placeholderPath = '/search';

/// The query-parameter key an optional initial search term travels under,
/// mirroring how [TyreSerial] rides along on `SerialSearchRoute` in
/// `routes.dart` - a route parameter, not a raw string, once this is
/// registered for real.
const String _qQuery = 'q';

/// Builds a `path?key=value&...` location string, dropping any null or
/// empty query values - the same shape `routes.dart`'s own private
/// `_location` helper produces, reimplemented here because that helper is
/// not exported and this file may not edit the file that owns it.
String _location(String path, [Map<String, String?>? query]) {
  if (query == null || query.isEmpty) return path;
  final Map<String, String> present = <String, String>{
    for (final MapEntry<String, String?> entry in query.entries)
      if (entry.value != null && entry.value!.isNotEmpty)
        entry.key: entry.value!,
  };
  if (present.isEmpty) return path;
  return Uri(path: path, queryParameters: present).toString();
}

/// The global cross-entity search screen's route.
///
/// Carries an optional [initialQuery] so a caller elsewhere in the app -
/// or a recent-search re-run - can deep-link straight into a populated
/// search rather than an empty box.
final class GlobalSearchRoute extends TpRoute {
  const GlobalSearchRoute({this.initialQuery});

  /// Decodes [params] the way the real router would once wired - reads
  /// the optional `q` query parameter via [TpRouteParameters
  /// .optionalQuery], which already treats a blank string as absent.
  static GlobalSearchRoute parse(TpRouteParameters params) {
    return GlobalSearchRoute(initialQuery: params.optionalQuery(_qQuery));
  }

  final String? initialQuery;

  @override
  String get routeId => _placeholderRouteId;

  @override
  String get location => _location(_placeholderPath, <String, String?>{
        _qQuery: initialQuery,
      });
}
