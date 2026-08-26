/// Wires the tyre records register into the router's screen registry.
///
/// `app/router/screen_registry.dart`'s own library comment explains why this
/// file exists rather than the router importing the feature directly: "The
/// alternative... would make the router the thing every screen has to
/// compile against and would invert the dependency the architecture is
/// arranged around." A future composition root builds the real registry
/// with `TpScreenRegistry.empty.withAll(recordsScreenRegistrations).withAll(
/// ...)` for every feature, none of which import each other.
///
/// [TyreRecordsRoute] carries no parameters of its own (see
/// `app/router/routes.dart`), so this builder needs nothing out of [TpRoute]
/// beyond deriving the correct Back fallback for it - see
/// [TpBackFallbacks.forRoute]'s own doc comment for why it takes the whole
/// route rather than just its id.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_records_list_screen.dart';

/// Every screen this feature contributes to the router, keyed by
/// [TpRoute.routeId]. Merge into the application-wide registry with
/// [TpScreenRegistry.withAll].
final Map<String, TpScreenBuilder> recordsScreenRegistrations =
    <String, TpScreenBuilder>{
      TpRouteId.tyreRecords: (BuildContext context, TpRoute route) {
        return TyreRecordsListScreen(
          backFallback: TpBackFallbacks.forRoute(route),
        );
      },
    };
