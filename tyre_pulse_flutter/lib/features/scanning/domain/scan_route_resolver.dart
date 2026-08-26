/// Maps a resolved scan to the typed route(s) it should offer.
///
/// Pure: no I/O, no Flutter widget imports, no Riverpod. Deliberately so -
/// this is the layer the feature inventory (artifact 01, section 2.6) asks
/// for under `features/scanning/domain/`, and keeping it free of anything
/// but `routes.dart` and this feature's own result type is what makes a
/// route mapping directly unit-testable on the values in and the routes
/// out, with no widget tree required.
///
/// # Why VehiclesRoute and SerialSearchRoute, specifically
///
/// `app/router/routes.dart`'s own doc comment on `VehiclesRoute` records the
/// production defect this rename fixes: "the production scanner passes `q`
/// here and the screen never reads it... A typed optional [assetNo] makes
/// that impossible to reintroduce." [primaryRouteFor] is the direct
/// continuation of that fix - an asset match resolves to
/// `VehiclesRoute(assetNo: ...)`, never to a bare, unread query string.
///
/// A tyre match, and every code this feature could not resolve, lands on
/// `SerialSearchRoute(tyreSerial: ...)` - the screen the inventory
/// describes as "Find a tyre by serial (typed, pasted or scanned)".
/// Prefilling that route with whatever code was extracted IS this
/// feature's manual-entry fallback: a real, full search screen the user can
/// correct a mis-scan in, never a dead end.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';

/// What a [ScanRouteAction] lets the user do next.
///
/// Deliberately an enum, not a label string: this layer decides WHAT is
/// offered, never how it reads in the user's language - that is
/// `AppLocalizations`'s job, resolved by the presentation layer.
enum ScanActionIntent {
  /// Open the fleet register focused on the matched asset.
  viewAsset,

  /// Start a new inspection, prefilled with the matched asset - and, when
  /// the match was a tyre fitted to one, that tyre and its position too.
  startInspection,

  /// Open Serial Search focused on the matched tyre.
  viewTyre,

  /// Open Serial Search with whatever code was extracted, so the user can
  /// search on it or correct it directly. The fallback for a miss, a
  /// lookup failure, and - once the code is genuinely empty - an
  /// unreadable payload.
  searchManually,
}

/// One thing the user can do with a resolved scan: what it is, in
/// [intent], and where it goes, in [route].
@immutable
final class ScanRouteAction {
  const ScanRouteAction({required this.intent, required this.route});

  final ScanActionIntent intent;
  final TpRoute route;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScanRouteAction &&
          other.intent == intent &&
          other.route == route;

  @override
  int get hashCode => Object.hash(intent, route);

  @override
  String toString() => 'ScanRouteAction(${intent.name} -> ${route.location})';
}

/// The single destination a resolved scan should navigate to first - item 5
/// of this feature's ported algorithm.
///
/// Always [actionsFor]'s FIRST entry, which is safe to take unconditionally
/// because every branch of that function's switch returns a non-empty list
/// - the invariant is enforced by inspection there, not re-checked here.
TpRoute primaryRouteFor(ScanLookupResult result) =>
    actionsFor(result).first.route;

/// Every action available for [result], in priority order. Never empty.
///
/// [ScanNoMatch] and [ScanLookupFailed] both resolve to the identical
/// manual-entry action - see the library comment - which is exactly item 6
/// of this feature's exit criterion: a scan that failed to match anything
/// must degrade to the same real search screen a genuine miss does, never
/// a second, unhandled kind of dead end.
List<ScanRouteAction> actionsFor(ScanLookupResult result) {
  return switch (result) {
    AssetScanMatch(asset: final AssetLookupRecord asset) => <ScanRouteAction>[
      ScanRouteAction(
        intent: ScanActionIntent.viewAsset,
        route: _assetRoute(asset),
      ),
      ScanRouteAction(
        intent: ScanActionIntent.startInspection,
        route: NewInspectionRoute(
          siteName: _siteNameOrNull(asset.site),
          assetNo: _assetNoOrNull(asset.assetNo),
        ),
      ),
    ],
    TyreScanMatch(tyre: final TyreLookupRecord tyre) => <ScanRouteAction>[
      ScanRouteAction(
        intent: ScanActionIntent.viewTyre,
        route: _serialSearchRoute(result.code),
      ),
      // Only offered when the tyre is actually fitted somewhere - starting
      // an inspection with no asset to inspect would be an action that
      // does nothing, which repository rule 7 forbids.
      if (_isNotBlank(tyre.assetNo))
        ScanRouteAction(
          intent: ScanActionIntent.startInspection,
          route: NewInspectionRoute(
            siteName: _siteNameOrNull(tyre.site),
            assetNo: _assetNoOrNull(tyre.assetNo),
            tyreSerial: _tyreSerialOrNull(result.code),
            tyrePosition: _tyrePositionOrNull(tyre.bestPosition),
          ),
        ),
    ],
    ScanNoMatch() => <ScanRouteAction>[
      ScanRouteAction(
        intent: ScanActionIntent.searchManually,
        route: _serialSearchRoute(result.code),
      ),
    ],
    ScanLookupFailed() => <ScanRouteAction>[
      ScanRouteAction(
        intent: ScanActionIntent.searchManually,
        route: _serialSearchRoute(result.code),
      ),
    ],
  };
}

TpRoute _assetRoute(AssetLookupRecord asset) =>
    VehiclesRoute(assetNo: _assetNoOrNull(asset.assetNo));

TpRoute _serialSearchRoute(String code) =>
    SerialSearchRoute(tyreSerial: _tyreSerialOrNull(code));

bool _isNotBlank(String? value) => value != null && value.trim().isNotEmpty;

AssetNo? _assetNoOrNull(String? value) =>
    _isNotBlank(value) ? AssetNo(value!.trim()) : null;

SiteName? _siteNameOrNull(String? value) =>
    _isNotBlank(value) ? SiteName(value!.trim()) : null;

TyreSerial? _tyreSerialOrNull(String? value) =>
    _isNotBlank(value) ? TyreSerial(value!.trim()) : null;

TyrePosition? _tyrePositionOrNull(String? value) =>
    _isNotBlank(value) ? TyrePosition(value!.trim()) : null;
