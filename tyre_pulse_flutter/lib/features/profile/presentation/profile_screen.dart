library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_display_preferences.dart';

const Color _blue = Color(0xFF0052FF);
const Color _navy = Color(0xFF071F68);
const Color _green = Color(0xFF07883F);
const Color _orange = Color(0xFFFF4B12);
const Color _border = Color(0xFFD7DFEC);

@visibleForTesting
abstract final class ProfileScreenKeys {
  static const Key hero = Key('profile.hero');
  static const Key status = Key('profile.status');
  static const Key workspace = Key('profile.workspace');
  static const Key offline = Key('profile.offline');
  static const Key access = Key('profile.access');
  static const Key account = Key('profile.account');
}

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({required this.route, super.key});
  final ProfileRoute route;

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _displayKey = GlobalKey();
  bool _isSigningOut = false;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _confirmAndSignOut() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
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
    await ref.read(authControllerProvider.notifier).signOut();
    if (mounted) setState(() => _isSigningOut = false);
  }

  Future<void> _showInfo(String title, String message) => showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: <Widget>[
            TpButton.text(
              label: MaterialLocalizations.of(dialogContext).closeButtonLabel,
              onPressed: () => Navigator.of(dialogContext).pop(),
            ),
          ],
        ),
      );

  void _scrollToDisplay() {
    final target = _displayKey.currentContext;
    if (target == null) return;
    unawaited(
      Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final profile = auth.profile;
    if (profile == null) return const TpScaffold(body: TpLoadingState());

    final notifications = ref.watch(unreadNotificationsCountProvider);
    final pending = ref.watch(homePendingSyncCountProvider);
    final tasks = ref.watch(homeTaskPreviewProvider);
    final moduleCount = profile.isSuperAdmin
        ? ModuleRegistry.all.length
        : ModuleRegistry.all
            .where((definition) => definition.allowsByRoleDefault(profile.role))
            .length;

    return TpScaffold(
      backgroundColor: TpPalette.of(context).surface,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        toolbarHeight: MediaQuery.sizeOf(context).width >= 600 ? 88 : 64,
        titleSpacing: MediaQuery.sizeOf(context).width >= 600 ? 29 : 16,
        backgroundColor: TpPalette.of(context).surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: const TpBrandLockup(),
        actions: <Widget>[
          _HeaderIcon(
            icon: Icons.notifications_none_rounded,
            badge: notifications.asData?.value,
            tooltip: _Copy.notifications,
            onPressed: () => context.push(const NotificationsRoute().location),
          ),
          _HeaderIcon(
            icon: Icons.settings_outlined,
            tooltip: _Copy.languageDisplay,
            onPressed: _scrollToDisplay,
          ),
          SizedBox(width: MediaQuery.sizeOf(context).width >= 600 ? 24 : 6),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final spacious = constraints.maxWidth >= 600;
          final side = spacious ? 35.0 : 16.0;
          return ListView(
            key: const Key('profile.scroll'),
            controller: _scrollController,
            padding: EdgeInsets.fromLTRB(side, spacious ? 18 : 12, side, 18),
            children: <Widget>[
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 992),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      _IdentityHero(
                        key: ProfileScreenKeys.hero,
                        profile: profile,
                        spacious: spacious,
                      ),
                      SizedBox(height: spacious ? 24 : 16),
                      _ProfileButtons(
                        spacious: spacious,
                        onEdit: () => _showInfo(
                          _Copy.editProfile,
                          _Copy.adminManagedMessage,
                        ),
                        onActivity: () =>
                            context.push(const ActivityHistoryRoute().location),
                      ),
                      SizedBox(height: spacious ? 24 : 18),
                      _KpiCard(
                        key: ProfileScreenKeys.status,
                        assignedTasks: tasks.when(
                          data: (rows) => '${rows.length}',
                          loading: () => '…',
                          error: (_, __) => '—',
                        ),
                        pendingDrafts: pending.when(
                          data: (value) => '$value',
                          loading: () => '…',
                          error: (_, __) => '—',
                        ),
                        profileStale: auth.profileStale,
                      ),
                      const SizedBox(height: 20),
                      _Section(
                        key: ProfileScreenKeys.access,
                        cardKey: ProfileScreenKeys.workspace,
                        title: _Copy.workspace,
                        children: <Widget>[
                          _SettingsRow(
                            icon: Icons.apartment_outlined,
                            label: _Copy.activeSite,
                            value: _site(profile),
                            onTap: () => _showInfo(
                              _Copy.activeSite,
                              _siteScope(profile),
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.language_outlined,
                            label: _Copy.countryCurrency,
                            value: _countryCurrency(profile),
                            onTap: () => _showInfo(
                              _Copy.countryCurrency,
                              _countryScope(profile),
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.group_outlined,
                            label: _Copy.rolesAccess,
                            value:
                                '${profile.role.displayName}  ·  $moduleCount ${_Copy.modules}',
                            onTap: () => _showInfo(
                              _Copy.rolesAccess,
                              '${profile.role.displayName}  ·  $moduleCount ${_Copy.modules}',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      ProfileDisplayPreferences(
                        key: _displayKey,
                        title: _Copy.languageDisplay,
                        appLanguageLabel: _Copy.appLanguage,
                        checklistLanguageLabel: _Copy.checklistLanguage,
                        checklistLanguageValue: _Copy.systemDefault,
                        checklistLanguageCaption: _Copy.independentLanguage,
                        themeLabel: _Copy.theme,
                      ),
                      const SizedBox(height: 18),
                      _Section(
                        title: _Copy.notifications,
                        children: <Widget>[
                          _SettingsRow(
                            icon: Icons.notifications_none_outlined,
                            label: _Copy.taskAlerts,
                            dense: true,
                            value: _Copy.on,
                            valueColor: _green,
                            onTap: () => context
                                .push(const NotificationsRoute().location),
                          ),
                          _SettingsRow(
                            icon: Icons.mail_outline,
                            label: _Copy.emailNotifications,
                            dense: true,
                            value: _Copy.adminManaged,
                            onTap: () => _showInfo(
                              _Copy.emailNotifications,
                              _Copy.adminManagedMessage,
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.warning_amber_rounded,
                            label: _Copy.accidentNotifications,
                            dense: true,
                            value: _Copy.adminManaged,
                            onTap: () => context
                                .push(const NotificationsRoute().location),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      _Section(
                        title: _Copy.securityIdentity,
                        children: <Widget>[
                          _SettingsRow(
                            icon: Icons.fingerprint,
                            label: _Copy.deviceBiometrics,
                            dense: true,
                            value: _Copy.available,
                            valueColor: _green,
                            onTap: () => _showInfo(
                              _Copy.deviceBiometrics,
                              _Copy.biometricMessage,
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.lock_outline,
                            label: _Copy.changePassword,
                            dense: true,
                            onTap: () => _showInfo(
                              _Copy.changePassword,
                              _Copy.passwordMessage,
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.draw_outlined,
                            label: _Copy.savedSignature,
                            dense: true,
                            value: _Copy.notRecorded,
                            onTap: () => _showInfo(
                              _Copy.savedSignature,
                              _Copy.notRecorded,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      _Section(
                        key: ProfileScreenKeys.offline,
                        title: _Copy.offlineData,
                        children: <Widget>[
                          _SettingsRow(
                            icon: Icons.cloud_done_outlined,
                            label: _Copy.syncStatus,
                            dense: true,
                            value: auth.profileStale
                                ? _Copy.cachedProfile
                                : _Copy.allRecordsSynced,
                            valueColor: auth.profileStale ? _orange : _green,
                            onTap: () => _showInfo(
                              _Copy.syncStatus,
                              auth.profileStale
                                  ? _Copy.cachedProfile
                                  : _Copy.allRecordsSynced,
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.note_alt_outlined,
                            label: _Copy.offlineDrafts,
                            dense: true,
                            value: pending.when(
                              data: (value) => '$value ${_Copy.storedSecurely}',
                              loading: () => '…',
                              error: (_, __) => _Copy.unavailable,
                            ),
                            valueColor: _orange,
                            onTap: () => context
                                .push(const ActivityHistoryRoute().location),
                          ),
                          _SettingsRow(
                            icon: Icons.storage_outlined,
                            label: _Copy.storageUsed,
                            dense: true,
                            value: _Copy.deviceManaged,
                            actionLabel: _Copy.manage,
                            onTap: () => _showInfo(
                              _Copy.storageUsed,
                              _Copy.storageMessage,
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.help_outline,
                            label: _Copy.helpSupport,
                            dense: true,
                            onTap: () => _showInfo(
                              _Copy.helpSupport,
                              _Copy.helpMessage,
                            ),
                          ),
                          _SettingsRow(
                            icon: Icons.shield_outlined,
                            label: _Copy.privacyAudit,
                            dense: true,
                            onTap: () => _showInfo(
                              _Copy.privacyAudit,
                              _Copy.privacyMessage,
                            ),
                          ),
                          const _SettingsRow(
                            icon: Icons.info_outline,
                            label: _Copy.appVersion,
                            dense: true,
                            value: String.fromEnvironment(
                              'APP_VERSION',
                              defaultValue: '0.1.0',
                            ),
                            showChevron: false,
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _SignOutButton(
                        key: ProfileScreenKeys.account,
                        busy: _isSigningOut,
                        onPressed: () => unawaited(_confirmAndSignOut()),
                      ),
                      const SizedBox(height: 10),
                      _DraftNotice(pending: pending),
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

class _HeaderIcon extends StatelessWidget {
  const _HeaderIcon({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.badge,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  final int? badge;

  @override
  Widget build(BuildContext context) => Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          IconButton(
            icon: Icon(icon, color: _navy),
            iconSize: 30,
            tooltip: tooltip,
            onPressed: onPressed,
          ),
          if ((badge ?? 0) > 0)
            PositionedDirectional(
              top: 4,
              end: 1,
              child: Container(
                constraints: const BoxConstraints(minWidth: 21, minHeight: 21),
                padding: const EdgeInsets.symmetric(horizontal: 5),
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: _orange,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '${badge! > 99 ? '99+' : badge}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
        ],
      );
}

class _IdentityHero extends StatelessWidget {
  const _IdentityHero({
    required this.profile,
    required this.spacious,
    super.key,
  });
  final WorkspaceProfile profile;
  final bool spacious;

  @override
  Widget build(BuildContext context) {
    final avatar = spacious ? 122.0 : 76.0;
    return Container(
      constraints: BoxConstraints(minHeight: spacious ? 195 : 0),
      padding: EdgeInsetsDirectional.only(start: spacious ? 14 : 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: EdgeInsets.only(top: spacious ? 9 : 0),
            child: Stack(
              children: <Widget>[
              Container(
                width: avatar,
                height: avatar,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFFF1F5FF),
                  border: Border.all(color: const Color(0xFFBBD0FF)),
                ),
                child: Text(
                  _initials(profile.fullName),
                  style: TextStyle(
                    color: _navy,
                    fontSize: spacious ? 38 : 28,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              PositionedDirectional(
                end: 5,
                bottom: 5,
                child: Container(
                  width: spacious ? 21 : 17,
                  height: spacious ? 21 : 17,
                  decoration: BoxDecoration(
                    color: profile.isLocked ? Colors.red : _green,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                  ),
                ),
              ),
              ],
            ),
          ),
          SizedBox(width: spacious ? 40 : 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  _value(profile.fullName),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: _navy,
                    fontSize: spacious ? 30 : 22,
                    height: 1.05,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                if (profile.employeeId != null)
                  _IdentityLine(
                    icon: Icons.person_outline,
                    text: '${_Copy.employeeId}  ${profile.employeeId}',
                  ),
                _IdentityLine(
                  icon: Icons.work_outline,
                  text: '${_Copy.role}  ${profile.role.displayName}',
                ),
                _IdentityLine(
                  icon: Icons.location_on_outlined,
                  text: _location(profile),
                ),
                if (profile.email != null)
                  _IdentityLine(
                    icon: Icons.mail_outline,
                    text: profile.email!,
                  ),
                _IdentityLine(
                  icon: profile.isApproved && !profile.isLocked
                      ? Icons.verified_user_outlined
                      : Icons.gpp_bad_outlined,
                  text: profile.isApproved && !profile.isLocked
                      ? _Copy.verifiedAccount
                      : _Copy.accessRestricted,
                  color: profile.isApproved && !profile.isLocked
                      ? _green
                      : Colors.red,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _IdentityLine extends StatelessWidget {
  const _IdentityLine({required this.icon, required this.text, this.color});
  final IconData icon;
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(
          children: <Widget>[
            Icon(icon, size: 18, color: color ?? _navy),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: color ?? _navy,
                  fontSize: 16,
                  height: 1.15,
                  fontWeight: color == null ? FontWeight.w500 : FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );
}

class _ProfileButtons extends StatelessWidget {
  const _ProfileButtons({
    required this.onEdit,
    required this.onActivity,
    required this.spacious,
  });
  final VoidCallback onEdit;
  final VoidCallback onActivity;
  final bool spacious;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsetsDirectional.only(
          start: spacious ? 87 : 0,
          end: spacious ? 74 : 0,
        ),
        child: Row(
          children: <Widget>[
            Expanded(
              child: _ProfileButton(
                icon: Icons.edit_outlined,
                label: _Copy.editProfile,
                onPressed: onEdit,
              ),
            ),
            const SizedBox(width: 20),
            Expanded(
              child: _ProfileButton(
                icon: Icons.show_chart,
                label: _Copy.myActivity,
                onPressed: onActivity,
                filled: true,
              ),
            ),
          ],
        ),
      );
}

class _ProfileButton extends StatelessWidget {
  const _ProfileButton({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.filled = false,
  });
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 48,
        child: filled
            ? FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: _blue,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(7),
                  ),
                ),
                onPressed: onPressed,
                icon: Icon(icon, size: 22),
                label: Text(label),
              )
            : OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: _blue,
                  side: const BorderSide(color: _blue, width: 1.5),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(7),
                  ),
                ),
                onPressed: onPressed,
                icon: Icon(icon, size: 22),
                label: Text(label),
              ),
      );
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.assignedTasks,
    required this.pendingDrafts,
    required this.profileStale,
    super.key,
  });
  final String assignedTasks;
  final String pendingDrafts;
  final bool profileStale;

  @override
  Widget build(BuildContext context) => _OutlinedCard(
        child: SizedBox(
          height: 96,
          child: Row(
            children: <Widget>[
              Expanded(
                child: _KpiCell(
                  icon: Icons.assignment_outlined,
                  value: assignedTasks,
                  label: _Copy.assignedTasks,
                  color: _green,
                ),
              ),
              const _KpiDivider(),
              Expanded(
                child: _KpiCell(
                  icon: Icons.note_alt_outlined,
                  value: pendingDrafts,
                  label: _Copy.pendingDrafts,
                  color: _orange,
                ),
              ),
              const _KpiDivider(),
              Expanded(
                child: _KpiCell(
                  icon: Icons.sync,
                  value: profileStale ? _Copy.cached : _Copy.synced,
                  label: _Copy.lastSync,
                  color: _green,
                ),
              ),
              const _KpiDivider(),
              const Expanded(
                child: _KpiCell(
                  icon: Icons.cloud_off_outlined,
                  value: '',
                  label: _Copy.offlineReady,
                  color: _blue,
                ),
              ),
            ],
          ),
        ),
      );
}

class _KpiDivider extends StatelessWidget {
  const _KpiDivider();
  @override
  Widget build(BuildContext context) =>
      const SizedBox(height: 48, child: VerticalDivider(width: 1));
}

class _KpiCell extends StatelessWidget {
  const _KpiCell({
    required this.icon,
    required this.value,
    required this.label,
    required this.color,
  });
  final IconData icon;
  final String value;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(icon, color: color, size: 34),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (value.isNotEmpty)
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: color,
                        fontSize: 20,
                        height: 1,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _navy,
                      fontSize: 14,
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.children,
    this.cardKey,
    super.key,
  });
  final String title;
  final List<Widget> children;
  final Key? cardKey;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 2, bottom: 8),
            child: Text(
              title,
              style: const TextStyle(
                color: _navy,
                fontSize: 19,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          _OutlinedCard(
            key: cardKey,
            child: Column(children: _divided(children)),
          ),
        ],
      );
}

List<Widget> _divided(List<Widget> rows) {
  final result = <Widget>[];
  for (var i = 0; i < rows.length; i++) {
    result.add(rows[i]);
    if (i != rows.length - 1) {
      result.add(const Divider(height: 1, color: _border));
    }
  }
  return result;
}

class _OutlinedCard extends StatelessWidget {
  const _OutlinedCard({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: TpPalette.of(context).surface,
          border: Border.all(color: _border),
          borderRadius: BorderRadius.circular(9),
        ),
        clipBehavior: Clip.antiAlias,
        child: child,
      );
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.icon,
    required this.label,
    this.value,
    this.valueColor,
    this.actionLabel,
    this.onTap,
    this.showChevron = true,
    this.dense = false,
  });
  final IconData icon;
  final String label;
  final String? value;
  final Color? valueColor;
  final String? actionLabel;
  final VoidCallback? onTap;
  final bool showChevron;
  final bool dense;

  @override
  Widget build(BuildContext context) => Semantics(
        button: onTap != null,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: dense ? 44 : 48),
            child: Padding(
              padding: EdgeInsets.symmetric(
                horizontal: 14,
                vertical: dense ? 4 : 8,
              ),
              child: Row(
                children: <Widget>[
                  Icon(icon, size: 23, color: _navy),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: _navy,
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  if (value != null) ...<Widget>[
                    const SizedBox(width: 10),
                    Flexible(
                      child: Text(
                        value!,
                        textAlign: TextAlign.end,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: valueColor ?? _navy,
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ],
                  if (actionLabel != null) ...<Widget>[
                    const SizedBox(width: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        border: Border.all(color: _blue),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        actionLabel!,
                        style: const TextStyle(color: _blue),
                      ),
                    ),
                  ],
                  if (showChevron) ...<Widget>[
                    const SizedBox(width: 10),
                    const Icon(Icons.chevron_right, size: 23, color: _navy),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
}

class _SignOutButton extends StatelessWidget {
  const _SignOutButton({
    required this.busy,
    required this.onPressed,
    super.key,
  });
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 48,
        child: OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.red,
            side: const BorderSide(color: Colors.red, width: 1.4),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          onPressed: busy ? null : onPressed,
          icon: busy
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.logout, size: 22),
          label: const Text(_Copy.signOut),
        ),
      );
}

class _DraftNotice extends StatelessWidget {
  const _DraftNotice({required this.pending});
  final AsyncValue<int> pending;

  @override
  Widget build(BuildContext context) {
    if ((pending.asData?.value ?? 0) <= 0) return const SizedBox.shrink();
    return const Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        Icon(Icons.error_outline, size: 20, color: _orange),
        SizedBox(width: 8),
        Flexible(
          child: Text(
            _Copy.draftsSafe,
            textAlign: TextAlign.center,
            style: TextStyle(color: _navy, fontSize: 14),
          ),
        ),
      ],
    );
  }
}

String _value(String? value) =>
    value == null || value.trim().isEmpty ? _Copy.unavailable : value.trim();

String _initials(String? raw) {
  final words = (raw ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((value) => value.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return '—';
  final first = String.fromCharCode(words.first.runes.first);
  if (words.length == 1) return first.toUpperCase();
  final last = String.fromCharCode(words.last.runes.first);
  return '$first$last'.toUpperCase();
}

String _site(WorkspaceProfile profile) => _value(profile.legacySite);

String _siteScope(WorkspaceProfile profile) {
  if (profile.siteScope.isOrganisationWide) return 'All';
  return profile.siteScope.namedSites.isEmpty
      ? _Copy.unavailable
      : profile.siteScope.namedSites.join(', ');
}

String _countryScope(WorkspaceProfile profile) {
  if (profile.countryScope.seesAllCountries) return 'All';
  return profile.countryScope.namedCountries.isEmpty
      ? _Copy.unavailable
      : profile.countryScope.namedCountries.join(', ');
}

String _countryCurrency(WorkspaceProfile profile) {
  final country = _countryScope(profile);
  final currency = switch (country.toLowerCase()) {
    'uae' || 'united arab emirates' => 'AED',
    'saudi arabia' || 'ksa' => 'SAR',
    'egypt' => 'EGP',
    _ => null,
  };
  return currency == null ? country : '$country  ·  $currency';
}

String _location(WorkspaceProfile profile) {
  final site = _site(profile);
  final country = _countryScope(profile);
  return country == 'All' || country == _Copy.unavailable
      ? site
      : '$site  ·  $country';
}

abstract final class _Copy {
  static const employeeId = 'Employee ID';
  static const role = 'Role';
  static const verifiedAccount = 'Verified account';
  static const accessRestricted = 'Account access restricted';
  static const editProfile = 'Edit profile';
  static const myActivity = 'My activity';
  static const assignedTasks = 'Assigned\ntasks';
  static const pendingDrafts = 'Pending\ndrafts';
  static const lastSync = 'Last sync';
  static const offlineReady = 'Offline-ready';
  static const cached = 'Cached';
  static const synced = 'Synced';
  static const workspace = 'Workspace';
  static const activeSite = 'Active site';
  static const countryCurrency = 'Country & currency';
  static const rolesAccess = 'My roles & access';
  static const modules = 'modules';
  static const languageDisplay = 'Language & display';
  static const appLanguage = 'App language';
  static const checklistLanguage = 'Checklist content language';
  static const systemDefault = 'System default';
  static const independentLanguage = 'Independent from app language';
  static const theme = 'Theme';
  static const notifications = 'Notifications';
  static const taskAlerts = 'Task & SLA alerts';
  static const emailNotifications = 'Email notifications';
  static const accidentNotifications = 'Accident workflow notifications';
  static const on = 'On';
  static const adminManaged = 'Admin managed';
  static const securityIdentity = 'Security & identity';
  static const deviceBiometrics = 'Device biometrics';
  static const available = 'Available';
  static const changePassword = 'Change password';
  static const savedSignature = 'My saved signature';
  static const notRecorded = 'Not recorded';
  static const offlineData = 'Offline & data';
  static const syncStatus = 'Sync status';
  static const allRecordsSynced = 'All records synced';
  static const cachedProfile = 'Using cached profile';
  static const offlineDrafts = 'Offline drafts';
  static const storedSecurely = 'stored securely';
  static const storageUsed = 'Storage used';
  static const deviceManaged = 'Device managed';
  static const manage = 'Manage';
  static const helpSupport = 'Help & support';
  static const privacyAudit = 'Privacy & audit';
  static const appVersion = 'App version';
  static const signOut = 'Sign out';
  static const draftsSafe = 'Unsynced drafts remain safely on this device';
  static const unavailable = 'Unavailable';
  static const adminManagedMessage =
      'This setting is managed by your Tyre Pulse administrator.';
  static const biometricMessage =
      'Device biometrics are available on the sign-in screen when enrolled.';
  static const passwordMessage =
      'Password resets are managed by your Tyre Pulse administrator.';
  static const storageMessage =
      'Tyre Pulse keeps offline work on this device until it is safely synced.';
  static const helpMessage =
      'Contact your Tyre Pulse administrator for account and application support.';
  static const privacyMessage =
      'Tyre Pulse records activity needed for operational auditability.';
}
