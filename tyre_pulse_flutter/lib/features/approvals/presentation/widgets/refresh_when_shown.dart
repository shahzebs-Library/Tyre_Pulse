/// Re-reads a queue whenever it comes back into view.
///
/// Both approval queues load their rows in `initState` only. That was the
/// cause of the "approval shows old data" report: the queues live inside a
/// `StatefulShellBranch`, so their `State` survives every tab switch and every
/// review pushed on top of them. A supervisor who opened Approvals in the
/// morning came back to a list read hours earlier, which does not contain the
/// inspection just submitted from the field. When that vehicle already had an
/// OLDER pending inspection, the stale list offered only that older row, and
/// opening it showed that older sheet's tyre readings - correctly for the row
/// tapped, but not the work the inspector had just finished.
///
/// The visibility signal is the same one Home already uses
/// (`home_screen.dart`): a shell branch that is not selected, and a route
/// covered by an opaque route above it, both run with tickers disabled, so
/// the flip back to enabled is the moment the queue is on screen again. An
/// app resume while the queue is on screen refreshes it too.
library;

import 'package:flutter/widgets.dart';

mixin RefreshWhenShown<T extends StatefulWidget> on State<T> {
  late final AppLifecycleListener _refreshLifecycle;
  bool _refreshWasVisible = true;

  /// Re-reads whatever this screen shows. Called after the frame, never
  /// during a build.
  void refreshWhenShown();

  @override
  void initState() {
    super.initState();
    _refreshLifecycle = AppLifecycleListener(onResume: _onResume);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool visible = TickerMode.valuesOf(context).enabled;
    if (visible && !_refreshWasVisible) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) refreshWhenShown();
      });
    }
    _refreshWasVisible = visible;
  }

  void _onResume() {
    if (!mounted || !_refreshWasVisible) return;
    refreshWhenShown();
  }

  @override
  void dispose() {
    _refreshLifecycle.dispose();
    super.dispose();
  }
}
