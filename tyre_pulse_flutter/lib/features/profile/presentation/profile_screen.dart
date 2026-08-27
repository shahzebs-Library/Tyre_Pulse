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
/// This screen is deliberately minimal - the same stopgap posture
/// `home_screen.dart`'s own earlier version documented for itself before
/// its replacement landed: real, honest content and one real action (sign
/// out), not an invented settings surface. A later phase may replace this
/// screen builder entirely, the same way that one was replaced; it should
/// not need to extend this one to do it.
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
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

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
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AuthState authState = ref.watch(authControllerProvider);
    final WorkspaceProfile? profile = authState.profile;

    return TpScaffold(
      // No back fallback: Profile is anchored - the root of its own branch,
      // exactly like Home - see `home_screen.dart`'s identical choice and
      // `tp_scaffold.dart`'s own library comment on what a null
      // `backFallback` means.
      appBar: TpAppBar(title: l10n.profileNavTitle, showBack: false),
      body: profile == null
          // Reachable only outside the normal shell flow (see the library
          // comment: `TpAppShell` never renders this branch's content until
          // `TpShellGate.none`, which itself requires a loaded profile) -
          // most concretely, a widget test that mounts this screen directly
          // with no session established yet. A real, temporary state, not a
          // fabricated one - the same choice `TpAppShell` itself makes for
          // "something is still being decided" via `TpBootScreen`.
          ? const TpLoadingState()
          : ListView(
              padding: const EdgeInsets.all(TpSpace.lg),
              children: <Widget>[
                _ProfileHeader(profile: profile),
                const SizedBox(height: TpSpace.xxl),
                TpButton.danger(
                  label: l10n.actionSignOut,
                  icon: Icons.logout,
                  isFullWidth: true,
                  isBusy: _isSigningOut,
                  onPressed: _isSigningOut
                      ? null
                      : () => unawaited(_confirmAndSignOut()),
                ),
              ],
            ),
    );
  }
}

/// The identity card at the top of the screen: name, role, super-admin
/// badge and site, each rendered from real [WorkspaceProfile] fields and
/// never fabricated - see the file's own library comment.
class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.profile});

  final WorkspaceProfile profile;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final String? name = profile.fullName;
    final String? site = profile.legacySite;

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.primarySoft,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.md),
                  child: Icon(
                    Icons.person_outline,
                    size: TpSizing.iconLg,
                    color: palette.primaryDark,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      (name == null || name.trim().isEmpty)
                          ? l10n.valueUnavailable
                          : name,
                      style: text.titleLarge,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      profile.role.displayName,
                      style: text.bodySmall?.copyWith(color: palette.textMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (profile.isSuperAdmin) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.info.soft,
                  borderRadius: BorderRadius.circular(TpRadius.pill),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: TpSpace.md,
                    vertical: TpSpace.xs,
                  ),
                  child: Text(
                    l10n.profileSuperAdminBadge,
                    style:
                        text.labelSmall?.copyWith(color: palette.info.onSoft),
                  ),
                ),
              ),
            ),
          ],
          const Divider(height: TpSpace.xxl),
          _ProfileRow(
            icon: Icons.badge_outlined,
            label: l10n.profileRoleLabel,
            value: profile.role.displayName,
          ),
          const SizedBox(height: TpSpace.md),
          _ProfileRow(
            icon: Icons.location_on_outlined,
            label: l10n.homeSiteStatLabel,
            value: (site == null || site.trim().isEmpty)
                ? l10n.homeSiteStatUnavailable
                : site,
          ),
        ],
      ),
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
      children: <Widget>[
        Icon(icon, size: TpSizing.iconMd, color: palette.textMuted),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: Text(label, style: text.bodyMedium),
        ),
        Text(
          value,
          style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}
