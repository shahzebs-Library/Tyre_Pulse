/// Where the router finds the widget for a route.
///
/// Navigation is being built before the feature screens exist. The alternative
/// to a registry would be for this layer to import every feature, which would
/// make the router the thing every screen has to compile against and would
/// invert the dependency the architecture is arranged around.
///
/// A route with no registered screen renders [TpScreenNotAvailableState], which
/// SAYS SO. It does not render a spinner, an empty list, or a placeholder that
/// looks like a real but empty screen - each of those would be a claim about
/// the fleet's data rather than about the build.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// Builds the screen for one route.
///
/// Takes the TYPED route, so a screen reads `route.assetNo` rather than
/// digging a string out of a map. That is the whole point of spec section 41.
typedef TpScreenBuilder = Widget Function(BuildContext context, TpRoute route);

/// The screens this build knows how to render.
@immutable
class TpScreenRegistry {
  const TpScreenRegistry(this.builders);

  /// Nothing registered. Every route renders the "not built yet" state.
  static const TpScreenRegistry empty = TpScreenRegistry(
    <String, TpScreenBuilder>{},
  );

  /// Keyed by [TpRoute.routeId].
  final Map<String, TpScreenBuilder> builders;

  /// Returns a new registry with [builders] merged over this one.
  ///
  /// Lets each feature contribute its own screens without one file having to
  /// import them all.
  TpScreenRegistry withAll(Map<String, TpScreenBuilder> additions) {
    return TpScreenRegistry(<String, TpScreenBuilder>{
      ...builders,
      ...additions,
    });
  }

  Widget build(BuildContext context, TpRoute route) {
    final TpScreenBuilder? builder = builders[route.routeId];
    if (builder != null) return builder(context, route);
    return TpScreenNotAvailable(route: route);
  }
}

/// Override this to register real screens.
final Provider<TpScreenRegistry> screenRegistryProvider =
    Provider<TpScreenRegistry>((ref) => TpScreenRegistry.empty);

/// The honest placeholder for a route whose screen has not been written.
class TpScreenNotAvailable extends StatelessWidget {
  const TpScreenNotAvailable({required this.route, super.key});

  final TpRoute route;

  @override
  Widget build(BuildContext context) {
    final String fallback = TpBackFallbacks.forRoute(route);
    return TpScaffold(
      backFallback: fallback,
      body: TpScreenNotAvailableState(
        routeId: route.routeId,
        onBack: () => backTo(TpBack.of(context), fallback: fallback),
      ),
    );
  }
}
