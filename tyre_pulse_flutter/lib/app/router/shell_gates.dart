/// The full-screen gates that run before the tabs render, and the boot screen.
///
/// Artifact 03 section 5.6: these are STATES, not routes. Putting them on
/// routes lets a deep link skip them, which is the whole reason a locked
/// account gate exists.
///
/// EVERY ACTION IS OPTIONAL AND EVERY BUTTON IS REAL. The callbacks live on
/// [TpShellGateActions], supplied by the authentication layer. When one is not
/// supplied, its button is NOT RENDERED - repository rule 7 forbids a control
/// that does nothing, and a Sign out button that does not sign out on a screen
/// whose only escape is signing out would be the worst possible place to break
/// that rule.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// What the gates can offer to do.
@immutable
class TpShellGateActions {
  const TpShellGateActions({
    this.onSignOut,
    this.onRetryProfile,
    this.onRetrySession,
    this.onOpenStore,
  });

  final VoidCallback? onSignOut;
  final VoidCallback? onRetryProfile;
  final VoidCallback? onRetrySession;
  final VoidCallback? onOpenStore;
}

/// Override this from the authentication layer.
final Provider<TpShellGateActions> shellGateActionsProvider =
    Provider<TpShellGateActions>((ref) => const TpShellGateActions());

/// The boot screen: session restore in progress.
///
/// Deliberately allowed to show a spinner, because this state ENDS - either in
/// a session, in no session, or in [TpSessionTimedOutScreen]. It is the one
/// place a spinner is the truth.
class TpBootScreen extends StatelessWidget {
  const TpBootScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpScaffold(
      body: TpLoadingState(message: l10n.sessionRestoringTitle),
    );
  }
}

/// The stored session could not be read in time.
///
/// Artifact 03 section 1.1 requires this third state. Reading the session out
/// of the Android keystore stalls on low-end hardware, and the boot screen used
/// to spin forever. A redirect that only knows "signed in / not signed in"
/// reproduces that exactly.
class TpSessionTimedOutScreen extends ConsumerWidget {
  const TpSessionTimedOutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpShellGateActions actions = ref.watch(shellGateActionsProvider);

    return TpScaffold(
      body: TpStateView(
        icon: Icons.hourglass_empty,
        tone: TpStatus.warning,
        title: l10n.sessionTimedOutTitle,
        message: l10n.sessionTimedOutMessage,
        primaryActionLabel: actions.onRetrySession == null
            ? null
            : l10n.actionRetry,
        onPrimaryAction: actions.onRetrySession,
        secondaryActionLabel: actions.onSignOut == null
            ? null
            : l10n.actionSignIn,
        onSecondaryAction: actions.onSignOut,
      ),
    );
  }
}

/// This build is too old to keep using.
///
/// There is deliberately NO "continue anyway". The gate upstream fails open by
/// construction - the check starts false and only flips when the server
/// explicitly says this build is too old - so by the time this screen renders,
/// the answer is not in doubt.
class TpUpdateRequiredScreen extends ConsumerWidget {
  const TpUpdateRequiredScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpShellGateActions actions = ref.watch(shellGateActionsProvider);

    return TpScaffold(
      body: TpStateView(
        icon: Icons.system_update,
        tone: TpStatus.info,
        title: l10n.updateRequiredTitle,
        message: l10n.updateRequiredMessage,
        primaryActionLabel: actions.onOpenStore == null
            ? null
            : l10n.actionOpenStore,
        onPrimaryAction: actions.onOpenStore,
        secondaryActionLabel: actions.onSignOut == null
            ? null
            : l10n.actionSignOut,
        onSecondaryAction: actions.onSignOut,
      ),
    );
  }
}

/// The profile did not load.
///
/// FAILS CLOSED. Without a profile the app cannot tell what the user may do,
/// and guessing is worse than saying so: a wrong guess either hides work
/// somebody needs or shows them an administration console.
class TpProfileUnavailableScreen extends ConsumerWidget {
  const TpProfileUnavailableScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpShellGateActions actions = ref.watch(shellGateActionsProvider);

    return TpScaffold(
      body: TpStateView(
        icon: Icons.person_outline,
        tone: TpStatus.critical,
        title: l10n.profileUnavailableTitle,
        message: l10n.profileUnavailableMessage,
        primaryActionLabel: actions.onRetryProfile == null
            ? null
            : l10n.actionRetry,
        onPrimaryAction: actions.onRetryProfile,
        secondaryActionLabel: actions.onSignOut == null
            ? null
            : l10n.actionSignOut,
        onSecondaryAction: actions.onSignOut,
      ),
    );
  }
}

/// The account is not approved, or is locked.
class TpAccessBlockedScreen extends ConsumerWidget {
  const TpAccessBlockedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpShellGateActions actions = ref.watch(shellGateActionsProvider);

    return TpScaffold(
      body: TpStateView(
        icon: Icons.block,
        tone: TpStatus.warning,
        title: l10n.accessBlockedTitle,
        message: l10n.accessBlockedMessage,
        primaryActionLabel: actions.onSignOut == null
            ? null
            : l10n.actionSignOut,
        onPrimaryAction: actions.onSignOut,
      ),
    );
  }
}

/// A link that points nowhere in this app.
///
/// Replaces the framework's developer error page. The production Expo app
/// shipped expo-router's raw "Unmatched Route" screen, complete with a Sitemap
/// link enumerating every route in the app, and the product owner reached it by
/// tapping a notification.
class TpRouteNotFoundScreen extends StatelessWidget {
  const TpRouteNotFoundScreen({
    this.attemptedLocation,
    this.onGoHome,
    super.key,
  });

  final String? attemptedLocation;

  /// A way out. A dead end reached from a notification tap is how the product
  /// owner ended up on a developer error screen with no way back.
  final VoidCallback? onGoHome;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpScaffold(
      body: TpStateView(
        icon: Icons.link_off,
        tone: TpStatus.neutral,
        title: l10n.routeNotFoundTitle,
        message: l10n.routeNotFoundMessage,
        detail: attemptedLocation,
        primaryActionLabel: onGoHome == null ? null : l10n.actionBack,
        onPrimaryAction: onGoHome,
      ),
    );
  }
}
