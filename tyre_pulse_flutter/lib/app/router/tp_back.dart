/// Adapts GoRouter onto the pure back navigation rule.
///
/// Kept separate from `back_navigation.dart` so that file stays free of any
/// router package and the rule itself can be tested without a widget tree.
library;

import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';

/// [TpBackRouter] over a [GoRouter].
class GoRouterBackAdapter implements TpBackRouter {
  const GoRouterBackAdapter(this._router);

  final GoRouter _router;

  @override
  bool canPop() => _router.canPop();

  @override
  void pop() => _router.pop();

  @override
  void go(String location) => _router.go(location);
}

/// Leaving a screen, from a [BuildContext].
abstract final class TpBack {
  /// The ambient router, or null when there is not one.
  ///
  /// Uses `maybeOf` rather than `of` deliberately: a design system widget
  /// rendered in a test harness with no router must produce
  /// [BackOutcome.unavailable], not an exception. A Back control that throws is
  /// worse than one that reports it could not act.
  static TpBackRouter? of(BuildContext context) {
    final GoRouter? router = GoRouter.maybeOf(context);
    return router == null ? null : GoRouterBackAdapter(router);
  }

  /// Leaves the current screen. See [backTo].
  static BackOutcome pop(
    BuildContext context, {
    String fallback = TpRoutePaths.home,
  }) {
    return backTo(of(context), fallback: fallback);
  }
}
