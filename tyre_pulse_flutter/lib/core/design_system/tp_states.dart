/// The seven states, rendered seven ways.
///
/// Spec section 58 and AGENTS.md:
///
/// > Loading, empty, offline-cached, permission-denied, backend-unavailable,
/// > not-configured and error are seven different states with seven different
/// > renderings. A spinner is none of them.
///
/// The production test `deniedIsNotASpinner` exists because this was got wrong
/// once, and the incident is worth restating because it explains the shape of
/// this file:
///
/// > Four admin screens wrote `if (loading || !allowed) return spinner`.
/// > `allowed` never becomes true for somebody who is denied, so that spinner
/// > ran FOREVER. The owner reported it as "I feel is spinner but in actual no
/// > access".
///
/// Three properties are built in rather than left to discipline:
///
/// 1. [TpLoadingState] is the ONLY widget in this file that contains a
///    progress indicator. Every other state is static text a person can read
///    and act on.
/// 2. [TpPermissionDeniedState] REQUIRES a reason. There is no constructor
///    that produces a refusal with nothing to say.
/// 3. A refusal does not navigate. The production guard used to call
///    `router.replace('/')`, which threw the user back to Home; a screen that
///    vanishes and dumps you on the main page reads as the app malfunctioning,
///    not as a permission boundary. It was reported twice. Every state here
///    stays put and offers an explicit Back.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/tp_button.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

/// Keys that identify each state in a widget tree.
///
/// These exist so a test can assert that two states really are DIFFERENT
/// renderings, rather than the same view with different words. Reviewing for
/// that does not work: a fused state looks identical to a correct one.
abstract final class TpStateKeys {
  static const Key loading = Key('tp.state.loading');
  static const Key empty = Key('tp.state.empty');
  static const Key offlineCached = Key('tp.state.offlineCached');
  static const Key permissionDenied = Key('tp.state.permissionDenied');
  static const Key backendUnavailable = Key('tp.state.backendUnavailable');
  static const Key notConfigured = Key('tp.state.notConfigured');
  static const Key error = Key('tp.state.error');
  static const Key screenNotAvailable = Key('tp.state.screenNotAvailable');
}

/// The shared layout for a full-screen state.
///
/// Public so a feature with a genuinely different state can use the same shape
/// rather than inventing one. It cannot render a spinner: there is no parameter
/// for one.
class TpStateView extends StatelessWidget {
  const TpStateView({
    required this.icon,
    required this.title,
    required this.message,
    this.tone = TpStatus.neutral,
    this.detail,
    this.primaryActionLabel,
    this.onPrimaryAction,
    this.secondaryActionLabel,
    this.onSecondaryAction,
    super.key,
  });

  final IconData icon;
  final String title;

  /// A sentence, in the user's language, that says what happened and what they
  /// can do. Never a driver message and never an error code.
  final String message;

  final TpStatus tone;

  /// An extra line, for something specific to this occurrence: which module,
  /// when the cached copy was taken. Optional because most states do not have
  /// one and an empty line reads as a missing string.
  final String? detail;

  final String? primaryActionLabel;
  final VoidCallback? onPrimaryAction;
  final String? secondaryActionLabel;
  final VoidCallback? onSecondaryAction;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(tone);
    final TextTheme text = Theme.of(context).textTheme;

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.xxl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: TpSizing.stateMaxWidth),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.soft,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.lg),
                  child: Icon(
                    icon,
                    size: TpSizing.iconState,
                    color: colors.onSoft,
                  ),
                ),
              ),
              const SizedBox(height: TpSpace.xl),
              Text(
                title,
                textAlign: TextAlign.center,
                style: text.headlineSmall,
              ),
              const SizedBox(height: TpSpace.sm),
              Text(
                message,
                textAlign: TextAlign.center,
                style: text.bodyMedium,
              ),
              if (detail != null) ...<Widget>[
                const SizedBox(height: TpSpace.sm),
                Text(
                  detail!,
                  textAlign: TextAlign.center,
                  style: text.labelSmall,
                ),
              ],
              if (primaryActionLabel != null && onPrimaryAction != null) ...[
                const SizedBox(height: TpSpace.xl),
                TpButton.primary(
                  label: primaryActionLabel!,
                  onPressed: onPrimaryAction,
                ),
              ],
              if (secondaryActionLabel != null &&
                  onSecondaryAction != null) ...[
                const SizedBox(height: TpSpace.sm),
                TpButton.text(
                  label: secondaryActionLabel!,
                  onPressed: onSecondaryAction,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Work is genuinely in flight and WILL end.
///
/// The only spinner in the design system. If a screen can reach this state and
/// stay in it, it is the wrong state - the thing that never ends is a refusal,
/// a failure or a gap, and each of those has its own widget below.
class TpLoadingState extends StatelessWidget {
  const TpLoadingState({this.message, super.key});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    return Center(
      key: TpStateKeys.loading,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox(
            width: TpSizing.iconLg,
            height: TpSizing.iconLg,
            child: CircularProgressIndicator(
              strokeWidth: 3,
              valueColor: AlwaysStoppedAnimation<Color>(palette.primary),
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            message ?? l10n.stateLoading,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

/// There is nothing to show, and that is not a fault.
class TpEmptyState extends StatelessWidget {
  const TpEmptyState({
    this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  final String? title;
  final String? message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStateView(
      key: TpStateKeys.empty,
      icon: icon,
      tone: TpStatus.neutral,
      title: title ?? l10n.stateEmptyTitle,
      message: message ?? l10n.stateEmptyMessage,
      primaryActionLabel: actionLabel,
      onPrimaryAction: onAction,
    );
  }
}

/// Showing the copy saved on this device.
///
/// Distinct from [TpEmptyState] and from [TpBackendUnavailableState]: there IS
/// data, it is just not fresh. Saying so is the difference between a field
/// worker trusting a number and acting on a stale one.
class TpOfflineCachedState extends StatelessWidget {
  const TpOfflineCachedState({
    this.cachedAtLabel,
    this.onRetry,
    super.key,
  });

  /// A formatted timestamp. Formatting belongs to the caller, which knows the
  /// locale and the user's timezone.
  final String? cachedAtLabel;

  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStateView(
      key: TpStateKeys.offlineCached,
      icon: Icons.cloud_off,
      tone: TpStatus.info,
      title: l10n.stateOfflineCachedTitle,
      message: l10n.stateOfflineCachedMessage,
      detail: cachedAtLabel == null
          ? null
          : l10n.stateOfflineCachedAt(cachedAtLabel!),
      primaryActionLabel: onRetry == null ? null : l10n.actionRetry,
      onPrimaryAction: onRetry,
    );
  }
}

/// The user is not allowed here, and this says why.
///
/// [reason] is REQUIRED and has no default. That is the whole point: there is
/// no way to construct a refusal that does not explain itself.
class TpPermissionDeniedState extends StatelessWidget {
  const TpPermissionDeniedState({
    required this.reason,
    this.onBack,
    super.key,
  });

  /// A sentence in the user's language. Not an error code, not a module key.
  final String reason;

  /// A way out. The production denial view carries one because a refusal
  /// without an exit is a dead screen - `admin/sites` shipped one of those and
  /// the user could only kill the app.
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStateView(
      key: TpStateKeys.permissionDenied,
      icon: Icons.lock_outline,
      tone: TpStatus.warning,
      title: l10n.deniedTitle,
      message: reason,
      primaryActionLabel: onBack == null ? null : l10n.actionBack,
      onPrimaryAction: onBack,
    );
  }
}

/// The server could not be reached.
///
/// Deliberately reassuring about queued work: the offline command queue means
/// a failed request is usually not lost work, and a field worker who believes
/// it is will stop and redo it.
class TpBackendUnavailableState extends StatelessWidget {
  const TpBackendUnavailableState({this.onRetry, this.detail, super.key});

  final VoidCallback? onRetry;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStateView(
      key: TpStateKeys.backendUnavailable,
      icon: Icons.cloud_queue,
      tone: TpStatus.warning,
      title: l10n.stateBackendUnavailableTitle,
      message: l10n.stateBackendUnavailableMessage,
      detail: detail,
      primaryActionLabel: onRetry == null ? null : l10n.actionRetry,
      onPrimaryAction: onRetry,
    );
  }
}

/// The feature exists but has not been set up for this organisation.
///
/// Not an error and not an empty list. Spec section 32 names this as one of the
/// three honest answers where a zero would be a lie.
class TpNotConfiguredState extends StatelessWidget {
  const TpNotConfiguredState({this.detail, this.title, super.key});

  /// What specifically is not set up.
  final String? detail;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStateView(
      key: TpStateKeys.notConfigured,
      icon: Icons.settings_outlined,
      tone: TpStatus.unknown,
      title: title ?? l10n.stateNotConfiguredTitle,
      message: l10n.stateNotConfiguredMessage,
      detail: detail,
    );
  }
}

/// Something failed.
///
/// Takes a typed [AppError] rather than a string, so the message shown is the
/// one that file already decided is safe to display and the technical detail
/// stays where it belongs - in telemetry. Spec section 57: a user must never
/// see `PostgrestException PGRST116`.
class TpErrorState extends StatelessWidget {
  const TpErrorState({required this.error, this.onRetry, super.key});

  final AppError error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool canRetry = onRetry != null && error.isRetryable;
    return TpStateView(
      key: TpStateKeys.error,
      icon: Icons.error_outline,
      tone: TpStatus.critical,
      title: l10n.stateErrorTitle,
      message: error.message,
      primaryActionLabel: canRetry ? l10n.actionRetry : null,
      onPrimaryAction: canRetry ? onRetry : null,
    );
  }
}

/// The route resolves but the screen behind it has not been written yet.
///
/// A build-in-progress state, not a product state. It is here rather than
/// reusing [TpNotConfiguredState] because those two say different things to
/// somebody in the field: one is "your administrator can turn this on", the
/// other is "this is not finished". Conflating them would send a user to their
/// administrator over an unwritten screen.
class TpScreenNotAvailableState extends StatelessWidget {
  const TpScreenNotAvailableState({this.routeId, this.onBack, super.key});

  final String? routeId;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpStateView(
      key: TpStateKeys.screenNotAvailable,
      icon: Icons.build_outlined,
      tone: TpStatus.unknown,
      title: l10n.stateScreenNotAvailableTitle,
      message: l10n.stateScreenNotAvailableMessage,
      detail: routeId,
      primaryActionLabel: onBack == null ? null : l10n.actionBack,
      onPrimaryAction: onBack,
    );
  }
}
