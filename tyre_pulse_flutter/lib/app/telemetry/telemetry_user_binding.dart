/// Keeps crash reporting tied to whoever is signed in.
///
/// Mounted once from `MaterialApp.router`'s `builder` in `main.dart`, beside
/// `PushBinding`. When a profile has loaded it hands the user id plus the
/// role and country to [TelemetryReporter.setUser]; on sign-out it clears
/// them, so the next person on a shared field phone is never reported as the
/// previous one. No email or name is ever passed (see `telemetry_user.dart`).
library;

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_providers.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_user.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// The telemetry identity for a loaded profile. Pure, for tests.
TelemetryUser telemetryUserFor(WorkspaceProfile profile) {
  final String role =
      profile.role.isKnown ? profile.role.token : profile.role.rawValue.trim();
  final String country = profile.countryScope.seesAllCountries
      ? 'all'
      : profile.countryScope.namedCountries
          .map((String c) => c.trim())
          .where((String c) => c.isNotEmpty)
          .join(',');
  return TelemetryUser(
    id: profile.userId,
    role: role.isEmpty ? null : role,
    country: country.isEmpty ? null : country,
  );
}

class TelemetryUserBinding extends ConsumerStatefulWidget {
  const TelemetryUserBinding({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<TelemetryUserBinding> createState() =>
      _TelemetryUserBindingState();
}

class _TelemetryUserBindingState extends ConsumerState<TelemetryUserBinding> {
  TelemetryUser? _current;
  bool _cleared = true;

  @override
  void initState() {
    super.initState();
    ref.listenManual<AuthState>(
      authControllerProvider,
      (AuthState? previous, AuthState next) => _onAuth(next),
      fireImmediately: true,
    );
  }

  void _onAuth(AuthState state) {
    final WorkspaceProfile? profile = state.profile;
    if (state.sessionPhase == AuthSessionPhase.authenticated &&
        state.profileStatus == ProfileStatus.loaded &&
        profile != null) {
      final TelemetryUser user = telemetryUserFor(profile);
      if (user == _current) return;
      _current = user;
      _cleared = false;
      unawaited(ref.read(telemetryReporterProvider).setUser(user));
      return;
    }
    if (state.sessionPhase == AuthSessionPhase.signedOut && !_cleared) {
      _current = null;
      _cleared = true;
      unawaited(ref.read(telemetryReporterProvider).setUser(null));
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
