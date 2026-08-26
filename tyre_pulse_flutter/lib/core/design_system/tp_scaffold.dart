/// The page frame.
///
/// The reason this exists rather than every screen using `Scaffold` directly is
/// the Android hardware Back button and the predictive back gesture. Artifact
/// 03 section 3.6, point 4:
///
/// > Android hardware Back and the predictive-back gesture must route through
/// > the same function. A `PopScope` that lets the framework pop by default
/// > reintroduces the dead-press case on a screen entered by deep link.
///
/// So the system gesture and the Back chevron in [TpAppBar] end at the same
/// rule, and neither can be a no-op.
///
/// HOW THE INTERCEPT IS SCOPED. It only engages when [backFallback] is set,
/// which means "this screen has a real parent". A branch root, or Home, leaves
/// [backFallback] null and gets the system default - so hardware Back still
/// EXITS THE APP from Home rather than trapping the user inside it. Intercepting
/// everywhere would be the opposite defect from the one being fixed.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';

class TpScaffold extends StatelessWidget {
  const TpScaffold({
    required this.body,
    this.appBar,
    this.banner,
    this.floatingActionButton,
    this.bottomNavigationBar,
    this.backgroundColor,
    this.backFallback,
    this.resizeToAvoidBottomInset = true,
    super.key,
  });

  final Widget body;
  final PreferredSizeWidget? appBar;

  /// Sits directly under the app bar, above the body. Intended for
  /// `TpOfflineBanner`, which renders nothing when there is nothing to say.
  final Widget? banner;

  final Widget? floatingActionButton;
  final Widget? bottomNavigationBar;
  final Color? backgroundColor;

  /// Where a system Back goes when there is no history.
  ///
  /// Null means "do not intercept": the framework handles Back, which on a root
  /// screen means leaving the app.
  final String? backFallback;

  final bool resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);

    final Widget scaffold = Scaffold(
      backgroundColor: backgroundColor ?? palette.background,
      appBar: appBar,
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottomNavigationBar,
      body: banner == null
          ? SafeArea(child: body)
          : SafeArea(
              child: Column(
                children: <Widget>[
                  banner!,
                  Expanded(child: body),
                ],
              ),
            ),
    );

    final String? fallback = backFallback;
    if (fallback == null) return scaffold;

    // Let the framework pop when there IS history; intercept only the case a
    // bare pop cannot handle. `backTo` re-checks, so a stale value here is
    // corrected rather than acted on.
    final bool routerCanPop = TpBack.of(context)?.canPop() ?? true;

    return PopScope<Object?>(
      canPop: routerCanPop,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) return;
        backTo(TpBack.of(context), fallback: fallback);
      },
      child: scaffold,
    );
  }
}
