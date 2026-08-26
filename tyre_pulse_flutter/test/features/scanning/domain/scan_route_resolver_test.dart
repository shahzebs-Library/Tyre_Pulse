/// Pins the route each [ScanLookupResult] shape maps to.
///
/// Every assertion reads a real [TpRoute.location] string, so a rename of a
/// query parameter in `app/router/routes.dart` - the exact class of defect
/// spec section 41 exists to prevent - fails here rather than surfacing as
/// a screen that silently ignores a scanned value.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_lookup.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_route_resolver.dart';

void main() {
  group('AssetScanMatch', () {
    const AssetLookupRecord asset = AssetLookupRecord(
      id: 'a1',
      assetNo: 'TM514',
      site: 'NHC',
      vehicleType: 'Tr-Mixer',
    );
    const AssetScanMatch match = AssetScanMatch(
      rawInput: 'TM514',
      code: 'TM514',
      asset: asset,
    );

    test(
        'the primary route is VehiclesRoute, carrying assetNo - never the '
        'unread q parameter the production scanner used to pass', () {
      final TpRoute route = primaryRouteFor(match);
      expect(route, isA<VehiclesRoute>());
      expect(route.location, contains('assetNo=TM514'));
      expect(route.location, isNot(contains('q=')));
    });

    test('actionsFor offers view-asset first, then start-inspection', () {
      final List<ScanRouteAction> actions = actionsFor(match);

      expect(actions, hasLength(2));
      expect(actions[0].intent, ScanActionIntent.viewAsset);
      expect(actions[0].route, isA<VehiclesRoute>());
      expect(actions[1].intent, ScanActionIntent.startInspection);
      expect(actions[1].route, isA<NewInspectionRoute>());
    });

    test('the inspection action carries the matched asset and site', () {
      final NewInspectionRoute route =
          actionsFor(match)[1].route as NewInspectionRoute;
      expect(route.assetNo, const AssetNo('TM514'));
      expect(route.siteName, const SiteName('NHC'));
    });

    test(
        'an asset with a blank asset_no produces a route with no assetNo '
        'parameter at all, never an empty one', () {
      const AssetLookupRecord blank = AssetLookupRecord(id: 'a2', assetNo: '');
      const AssetScanMatch blankMatch = AssetScanMatch(
        rawInput: 'x',
        code: 'x',
        asset: blank,
      );

      final TpRoute route = primaryRouteFor(blankMatch);
      expect(route.location, isNot(contains('assetNo=')));
    });
  });

  group('TyreScanMatch', () {
    const TyreLookupRecord fittedTyre = TyreLookupRecord(
      id: 't1',
      brand: 'Bridgestone',
      size: '315/80R22.5',
      tyrePosition: 'LHF1',
      assetNo: 'TM514',
      site: 'NHC',
    );

    test(
        'the primary route is SerialSearchRoute, carrying the matched '
        'code', () {
      const TyreScanMatch match = TyreScanMatch(
        rawInput: 'EP0604207',
        code: 'EP0604207',
        tyre: fittedTyre,
      );

      final TpRoute route = primaryRouteFor(match);
      expect(route, isA<SerialSearchRoute>());
      expect(route.location, contains('tyreSerial=EP0604207'));
    });

    test(
        'a tyre fitted to an asset offers a second action to start an '
        'inspection there, prefilled with its position', () {
      const TyreScanMatch match = TyreScanMatch(
        rawInput: 'EP0604207',
        code: 'EP0604207',
        tyre: fittedTyre,
      );

      final List<ScanRouteAction> actions = actionsFor(match);
      expect(actions, hasLength(2));
      expect(actions[0].intent, ScanActionIntent.viewTyre);
      expect(actions[1].intent, ScanActionIntent.startInspection);

      final NewInspectionRoute inspect = actions[1].route as NewInspectionRoute;
      expect(inspect.assetNo, const AssetNo('TM514'));
      expect(inspect.siteName, const SiteName('NHC'));
      expect(inspect.tyreSerial, const TyreSerial('EP0604207'));
      expect(inspect.tyrePosition, const TyrePosition('LHF1'));
    });

    test(
        'the legacy position column is used only when the canonical one '
        'is absent', () {
      const TyreLookupRecord legacyOnly = TyreLookupRecord(
        id: 't2',
        position: 'LHF1 (legacy)',
        assetNo: 'TM514',
      );
      const TyreScanMatch match = TyreScanMatch(
        rawInput: 'S1',
        code: 'S1',
        tyre: legacyOnly,
      );

      final NewInspectionRoute inspect =
          actionsFor(match)[1].route as NewInspectionRoute;
      expect(inspect.tyrePosition, const TyrePosition('LHF1 (legacy)'));
    });

    test(
        'a tyre not fitted to any asset offers ONLY the view action - '
        'starting an inspection with nothing to inspect is never offered', () {
      const TyreLookupRecord unfitted = TyreLookupRecord(id: 't3');
      const TyreScanMatch match = TyreScanMatch(
        rawInput: 'S2',
        code: 'S2',
        tyre: unfitted,
      );

      final List<ScanRouteAction> actions = actionsFor(match);
      expect(actions, hasLength(1));
      expect(actions.single.intent, ScanActionIntent.viewTyre);
    });
  });

  group('ScanNoMatch', () {
    test(
        'offers exactly one action: search manually, prefilled with the '
        'extracted code', () {
      const ScanNoMatch result = ScanNoMatch(rawInput: 'x', code: 'ABC123');

      final List<ScanRouteAction> actions = actionsFor(result);
      expect(actions, hasLength(1));
      expect(actions.single.intent, ScanActionIntent.searchManually);

      final TpRoute route = primaryRouteFor(result);
      expect(route, isA<SerialSearchRoute>());
      expect(route.location, contains('tyreSerial=ABC123'));
    });

    test(
        'an empty code produces a route with no tyreSerial parameter, '
        'never an empty one - a blank prefill is not a prefill', () {
      const ScanNoMatch result = ScanNoMatch(rawInput: '', code: '');

      final TpRoute route = primaryRouteFor(result);
      expect(route.location, isNot(contains('tyreSerial=')));
    });
  });

  group('ScanLookupFailed', () {
    test(
        'resolves to the identical manual-entry action a clean miss '
        'does - a failure is never a different kind of dead end', () {
      const ScanNoMatch miss = ScanNoMatch(rawInput: 'x', code: 'ABC');
      const AppError anyError = AppError(
        kind: AppErrorKind.network,
        message: 'offline',
      );
      const ScanLookupFailed failure = ScanLookupFailed(
        rawInput: 'x',
        code: 'ABC',
        error: anyError,
      );

      expect(primaryRouteFor(failure), primaryRouteFor(miss));
      expect(
        actionsFor(failure).single.intent,
        ScanActionIntent.searchManually,
      );
    });
  });

  group('ScanRouteAction equality', () {
    test('two actions with the same intent and route are equal', () {
      const ScanRouteAction a = ScanRouteAction(
        intent: ScanActionIntent.viewAsset,
        route: VehiclesRoute(assetNo: AssetNo('TM514')),
      );
      const ScanRouteAction b = ScanRouteAction(
        intent: ScanActionIntent.viewAsset,
        route: VehiclesRoute(assetNo: AssetNo('TM514')),
      );

      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a different route makes them unequal', () {
      const ScanRouteAction a = ScanRouteAction(
        intent: ScanActionIntent.viewAsset,
        route: VehiclesRoute(assetNo: AssetNo('TM514')),
      );
      const ScanRouteAction b = ScanRouteAction(
        intent: ScanActionIntent.viewAsset,
        route: VehiclesRoute(assetNo: AssetNo('TM999')),
      );

      expect(a, isNot(b));
    });
  });
}
