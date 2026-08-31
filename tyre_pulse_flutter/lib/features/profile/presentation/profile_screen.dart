/// The Profile branch root.
///
/// # Why this file exists
///
/// `ProfileRoute` (`/profile`) already existed - it is one of the shell's
/// nine anchored branches (`shell_tabs.dart` marks it `isAnchored: true`,
/// alongside Home, "because it carries the offline queue: sync notifications
/// route to it, so a field worker must always be one tap from it") - but
/// nothing registered a screen for it, so it rendered
/// [TpScreenNotAvailableState] app-wide. Worse: a grep of every feature finds
/// NO call to [AuthController.signOut] anywhere in this codebase. Once
/// somebody signs in through `login_screen.dart`, there was no control in the
/// entire app that could sign them back out.
///
/// The first implementation was deliberately minimal: one identity card and
/// sign out. This is the richer PMV operations presentation that replaces
/// that stopgap. It follows Home's daylight visual language while retaining
/// the same deliberately small FUNCTIONAL surface: real profile/access facts
/// and the one real account action already supported by the application.
///
/// # What is shown, and why nothing here is fabricated
///
/// Everything on screen comes straight off [WorkspaceProfile], the decoded
/// `profiles` row already carried on [AuthState.profile] once
/// [ProfileStatus.loaded] - see that class's own library comment for exactly
/// which column backs which field. [WorkspaceProfile.fullName] is nullable
/// and rendered through [AppLocalizations.valueUnavailable] when absent,
/// never through an invented placeholder name (AGENTS.md rule 1: never
/// fabricate fleet data - the same principle extends to the person using
/// it). [WorkspaceProfile.displayName]-equivalent for the role is
/// [UserRole.displayName], which already handles an unknown or absent role
/// honestly on its own (`roles.dart`'s own doc comment: "Safe to show a
/// person... and a stated placeholder when there is nothing" - never
/// coerced to a default role).
///
/// # Sign-out: confirmed, then routed through the one real path
///
/// The sign-out action is gated behind a confirmation dialog on purpose - an
/// accidental tap ending a field worker's session mid-shift is a real cost,
/// not a inconvenience to shrug off. Confirmed, it calls
/// `ref.read(authControllerProvider.notifier).signOut()` directly: the exact
/// same call `buildAuthShellGateActions` in `auth_providers.dart` already
/// wires for every shell gate's own sign-out control
/// (`onSignOut: () => unawaited(notifier().signOut())`), so this screen adds
/// no second way of ending a session, only the first reachable ENTRY point to
/// the one that already existed. [AuthController.signOut]'s own library
/// comment is explicit about what that call does and does not touch: it ends
/// the Supabase session and clears this lane's own profile cache, and
/// "imports nothing from `core/database` or any sync/queue module... there is
/// no code path by which it COULD reach the offline command queue or a
/// draft." The confirmation dialog's own copy
/// ([AppLocalizations.profileSignOutConfirmMessage]) states that guarantee to
/// the person about to press it, not just to a reader of this comment.
///
/// This screen never navigates on success, for the identical reason
/// `login_screen.dart`'s own library comment gives for sign-IN: the resulting
/// session change reaches `app_router.dart`'s `resolveRedirect` through the
/// same stream every other transition uses, and it is the one place that
/// decides where the app goes next.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/notifications/presentation/notifications_copy.dart';

/// Stable finders for Profile's responsive visual regions.
@visibleForTesting
abstract final class ProfileScreenKeys {
  static const Key hero = Key('profile.hero');
  static const Key access = Key('profile.access');
  static const Key account = Key('profile.account');
}

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({required this.route, super.key});

  /// [ProfileRoute] carries no parameters of its own. Threaded through
  /// anyway, matching every other registered screen in this codebase.
  final ProfileRoute route;

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _isSigningOut = false;

  Future<void> _confirmAndSignOut() async {
    final AppLocalizations l10n = AppLocalizations.of(context);

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.profileSignOutConfirmTitle),
        content: Text(l10n.profileSignOutConfirmMessage),
        actions: <Widget>[
          TpButton.text(
            label: l10n.actionCancel,
            onPressed: () => Navigator.of(dialogContext).pop(false),
          ),
          TpButton.danger(
            label: l10n.actionSignOut,
            onPressed: () => Navigator.of(dialogContext).pop(true),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _isSigningOut = true);
    // `AuthController.signOut()` never throws - see its own library comment
    // ("Best-effort... Pressing the one control meant to escape a stuck
    // screen must always reach the login screen") - so there is nothing to
    // catch here. The router's redirect unmounts this screen once the
    // resulting signedOut session reaches it; `_isSigningOut` only needs
    // clearing for the frame or two before that happens, guarded by
    // `mounted` for the case this widget is gone by the time the await
    // returns.
    await ref.read(authControllerProvider.notifier).signOut();
    if (mounted) {
      setState(() => _isSigningOut = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AuthState authState = ref.watch(authControllerProvider);
    final WorkspaceProfile? profile = authState.profile;

    return TpScaffold(
      // No back fallback: Profile is anchored - the root of its own branch,
      // exactly like Home - see `home_screen.dart`'s identical choice and
      // `tp_scaffold.dart`'s own library comment on what a null
      // `backFallback` means.
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: TpSpace.lg,
        title: const TpBrandLockup(),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.notifications_none_rounded),
            tooltip: NotificationsCopy.of(context)('title'),
            onPressed: () => context.push(const NotificationsRoute().location),
          ),
          const SizedBox(width: TpSpace.sm),
        ],
      ),
      body: profile == null
          // Reachable only outside the normal shell flow (see the library
          // comment: `TpAppShell` never renders this branch's content until
          // `TpShellGate.none`, which itself requires a loaded profile) -
          // most concretely, a widget test that mounts this screen directly
          // with no session established yet. A real, temporary state, not a
          // fabricated one - the same choice `TpAppShell` itself makes for
          // "something is still being decided" via `TpBootScreen`.
          ? const TpLoadingState()
          : LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final double horizontalPadding =
                    constraints.maxWidth >= 760 ? TpSpace.xxl : TpSpace.lg;

                return ListView(
                  padding: EdgeInsets.fromLTRB(
                    horizontalPadding,
                    TpSpace.lg,
                    horizontalPadding,
                    TpSpace.xxxl,
                  ),
                  children: <Widget>[
                    Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 960),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            _IdentityHero(profile: profile),
                            const SizedBox(height: TpSpace.lg),
                            _ProfileGroups(
                              profile: profile,
                              isSigningOut: _isSigningOut,
                              onSignOut: () => unawaited(_confirmAndSignOut()),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
    );
  }
}

/// The compact identity block from the approved profile mock.
///
/// Only verified profile fields are rendered. The mock contains employee ID
/// and email examples, but the current `WorkspaceProfile` query does not own
/// those columns, so this screen does not invent them to fill visual space.
class _IdentityHero extends StatelessWidget {
  const _IdentityHero({required this.profile});

  final WorkspaceProfile profile;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final String? name = profile.fullName;
    final String? site = profile.legacySite;

    return TpCard(
      key: ProfileScreenKeys.hero,
      background: palette.surface,
      borderColor: palette.border,
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Stack(
            clipBehavior: Clip.none,
            children: <Widget>[
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: palette.primarySoft,
                  border: Border.all(
                    color: palette.primary.withValues(alpha: 0.28),
                  ),
                ),
                alignment: Alignment.center,
                child: Text(
                  _profileInitials(name),
                  style: text.headlineMedium?.copyWith(
                    color: palette.primaryDark,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              PositionedDirectional(
                end: 2,
                bottom: 2,
                child: Container(
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: profile.isLocked
                        ? palette.critical.base
                        : palette.ok.base,
                    border: Border.all(color: palette.surface, width: 3),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: TpSpace.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  (name == null || name.trim().isEmpty)
                      ? l10n.valueUnavailable
                      : name,
                  style: text.titleLarge?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w800,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: TpSpace.xs),
                _IdentityLine(
                  icon: Icons.badge_outlined,
                  value: profile.role.displayName,
                ),
                const SizedBox(height: 3),
                _IdentityLine(
                  icon: Icons.location_on_outlined,
                  value: (site == null || site.trim().isEmpty)
                      ? l10n.homeSiteStatUnavailable
                      : site,
                ),
                const SizedBox(height: 5),
                _IdentityLine(
                  icon: profile.isApproved && !profile.isLocked
                      ? Icons.verified_user_outlined
                      : Icons.gpp_bad_outlined,
                  value: profile.isApproved && !profile.isLocked
                      ? l10n.inspectionStatusSynced
                      : l10n.accessBlockedMessage,
                  color: profile.isApproved && !profile.isLocked
                      ? palette.ok.base
                      : palette.critical.base,
                ),
                if (profile.isSuperAdmin) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  _IdentityBadge(
                    label: l10n.profileSuperAdminBadge,
                    background: palette.info.soft,
                    foreground: palette.info.onSoft,
                    icon: Icons.admin_panel_settings_outlined,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _IdentityLine extends StatelessWidget {
  const _IdentityLine({
    required this.icon,
    required this.value,
    this.color,
  });

  final IconData icon;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color foreground = color ?? palette.textSecondary;
    return Row(
      children: <Widget>[
        Icon(icon, size: 16, color: foreground),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: foreground,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ),
      ],
    );
  }
}

String _profileInitials(String? raw) {
  final List<String> words = (raw ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((String value) => value.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return '—';
  final String first = String.fromCharCode(words.first.runes.first);
  if (words.length == 1) return first.toUpperCase();
  final String last = String.fromCharCode(words.last.runes.first);
  return '$first$last'.toUpperCase();
}

class _IdentityBadge extends StatelessWidget {
  const _IdentityBadge({
    required this.label,
    required this.background,
    required this.foreground,
    required this.icon,
  });

  final String label;
  final Color background;
  final Color foreground;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: TpSpace.xs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: TpSizing.iconSm, color: foreground),
            const SizedBox(width: TpSpace.xs),
            Flexible(
              child: Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: foreground,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileGroups extends StatelessWidget {
  const _ProfileGroups({
    required this.profile,
    required this.isSigningOut,
    required this.onSignOut,
  });

  final WorkspaceProfile profile;
  final bool isSigningOut;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final Widget access = _AccessCard(profile: profile);
    final Widget account = _AccountCard(
      isSigningOut: isSigningOut,
      onSignOut: onSignOut,
    );

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth >= 720) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(flex: 3, child: access),
              const SizedBox(width: TpSpace.lg),
              Expanded(flex: 2, child: account),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            access,
            const SizedBox(height: TpSpace.lg),
            account,
          ],
        );
      },
    );
  }
}

class _AccessCard extends StatelessWidget {
  const _AccessCard({required this.profile});

  final WorkspaceProfile profile;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);

    return TpCard(
      key: ProfileScreenKeys.access,
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _GroupHeading(
            icon: Icons.admin_panel_settings_outlined,
            title: l10n.loginOperationsTitle,
            tone: palette.info,
          ),
          const SizedBox(height: TpSpace.lg),
          _ProfileRow(
            icon: Icons.badge_outlined,
            label: l10n.profileRoleLabel,
            value: profile.role.displayName,
          ),
          const Divider(height: TpSpace.xxl),
          _ProfileRow(
            icon: Icons.public_outlined,
            label: l10n.vehiclesFieldCountry,
            value: _countryScopeLabel(profile, l10n),
          ),
          const Divider(height: TpSpace.xxl),
          _ProfileRow(
            icon: Icons.location_on_outlined,
            label: l10n.vehiclesFieldSite,
            value: _siteScopeLabel(profile, l10n),
          ),
        ],
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({
    required this.isSigningOut,
    required this.onSignOut,
  });

  final bool isSigningOut;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return TpCard(
      key: ProfileScreenKeys.account,
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _GroupHeading(
            icon: Icons.manage_accounts_outlined,
            title: l10n.profileNavTitle,
            tone: palette.neutral,
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.profileSignOutConfirmMessage,
            style: text.bodyMedium?.copyWith(color: palette.textMuted),
          ),
          const SizedBox(height: TpSpace.lg),
          TpButton.danger(
            label: l10n.actionSignOut,
            icon: Icons.logout,
            isFullWidth: true,
            isBusy: isSigningOut,
            onPressed: isSigningOut ? null : onSignOut,
          ),
        ],
      ),
    );
  }
}

class _GroupHeading extends StatelessWidget {
  const _GroupHeading({
    required this.icon,
    required this.title,
    required this.tone,
  });

  final IconData icon;
  final String title;
  final TpStatusColors tone;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        DecoratedBox(
          decoration: BoxDecoration(
            color: tone.soft,
            borderRadius: BorderRadius.circular(TpRadius.md),
          ),
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Icon(icon, size: TpSizing.iconMd, color: tone.onSoft),
          ),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
      ],
    );
  }
}

class _ProfileRow extends StatelessWidget {
  const _ProfileRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(icon, size: TpSizing.iconMd, color: palette.textMuted),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          flex: 2,
          child: Text(label, style: text.bodyMedium),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          flex: 3,
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}

String _countryScopeLabel(
  WorkspaceProfile profile,
  AppLocalizations l10n,
) {
  if (profile.countryScope.seesAllCountries) {
    return l10n.vehiclesAllFilter;
  }
  final List<String> countries = profile.countryScope.namedCountries;
  return countries.isEmpty ? l10n.valueUnavailable : countries.join(', ');
}

String _siteScopeLabel(WorkspaceProfile profile, AppLocalizations l10n) {
  if (profile.siteScope.isOrganisationWide) {
    return l10n.vehiclesAllFilter;
  }
  final List<String> sites = profile.siteScope.namedSites;
  return sites.isEmpty ? l10n.valueUnavailable : sites.join(', ');
}
