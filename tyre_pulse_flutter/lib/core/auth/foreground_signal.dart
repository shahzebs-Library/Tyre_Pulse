/// The one fact the auth layer needs from the app's lifecycle: that it has
/// just come back to the foreground.
///
/// # Why this is its own tiny interface
///
/// [AppLifecycleListener] is a real Flutter framework binding, and
/// constructing one requires `WidgetsFlutterBinding` to be live. A plain unit
/// test of [AuthController] - which this task requires - has no widget tree
/// and no reason to need one; the joint-resolving rule, the timeout path, and
/// the sign-out guarantee are all provable over plain Dart values. Isolating
/// the ONE binding-dependent construct behind [ForegroundSignal] means a test
/// can supply a trivial fake (a bare `StreamController`) and the controller
/// never has to know the difference - the same reasoning that put
/// [AuthSessionSignal] between `AuthController` and the Supabase SDK in
/// `auth_repository.dart`.
///
/// Foreground revalidation - re-checking that an account has not been locked
/// while the phone slept, and nudging the SDK to renew its access token - is
/// named directly in spec section 6 ("foreground revalidation") and is why
/// this exists at all; see `AuthController` for what actually happens on the
/// signal.
library;

import 'dart:async';

import 'package:flutter/widgets.dart';

/// The narrow surface [AuthController] needs from the app's lifecycle.
abstract interface class ForegroundSignal {
  /// Emits once per transition into the foreground. Nothing downstream needs
  /// to know about any other lifecycle state.
  Stream<void> get onResumed;

  /// Releases whatever platform resources back [onResumed]. Idempotent.
  void dispose();
}

/// The real implementation, over Flutter's own [AppLifecycleListener].
final class AppLifecycleForegroundSignal implements ForegroundSignal {
  AppLifecycleForegroundSignal() {
    _controller = StreamController<void>.broadcast();
    _listener = AppLifecycleListener(onResume: () => _controller.add(null));
  }

  late final StreamController<void> _controller;
  late final AppLifecycleListener _listener;

  @override
  Stream<void> get onResumed => _controller.stream;

  @override
  void dispose() {
    _listener.dispose();
    unawaited(_controller.close());
  }
}
