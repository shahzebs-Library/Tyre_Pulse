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
///
/// # Layout, aligned to the approved profile mock (19-profile)
///
/// Open identity header (no card), a status strip of REAL counts, then
/// grouped settings sections with their headers outside the rows, and a
/// full-width outlined sign-out. Every row of the mock that has no backend or
/// no route in this app (edit profile, my activity, notification toggles,
/// biometrics, change password, help, privacy, storage) is deliberately
/// ABSENT, not rendered as a control that does nothing (AGENTS.md rule 7).
/// Rows that only report a fact carry no chevron; a chevron means the row
/// really opens something. The app keeps its own green theme.
///
/// Counts come from providers, read only: `profilePendingSyncCountProvider`
/// (a LIVE watch over the offline queue via `QueueDao.watchPendingCount`, so
/// the count and the unsynced-work line never go stale while this anchored
/// screen stays mounted) and `unreadNotificationsCountProvider` (the live
/// inbox). A count that could not be read renders `-`, never `0` (AGENTS.md
/// "States are not all the same thing"), and an unreadable queue still shows
/// the warning under Sign out: unknown is treated as "may have unsynced
/// work", never as "nothing queued".
///
/// The mock's "Assigned tasks" and "Last sync" tiles are deliberately absent.
/// `corrective_actions.assigned_to` is free text with no per-user filter in
/// `TasksRepository`, so a "mine" count would be an invented query; and the
/// sync engine records only when a run ENDED (`sync.lastRunAt`, written in a
/// `finally` whether the run succeeded or not), not a last SUCCESSFUL sync.
/// "Help & support" and "Privacy & audit" have no route in `routes.dart`, so
/// they are absent rather than dead rows.
///
/// # Mock-parity pass (Profile.png, batch 2)
///
/// Added, each backed by real data: "Verified account" (an approved,
/// unlocked `profiles` row), "Pending drafts" / "Offline drafts" (drafts with
/// real content in the local draft store - `profileDraftCountProvider`),
/// "Country & currency" (the scope plus the server-resolved workspace
/// currency, omitted when null), "My roles & access" (role and the number of
/// modules the access resolver actually grants), "Checklist content
/// language" (the checklist hub's own content-language selection, separate
/// from the app language), and "My saved signature" (V601 `user_signatures`:
/// view, draw a new one, or remove - online only).
///
/// Mock-parity pass 3: "Assigned tasks" is now real. The per-person work
/// list the "My tasks" screen renders (`myWorkSnapshotProvider`: checklist
/// assignments for the role, this person's inspection plans, work orders and
/// corrective actions, and drafts on this device) is the source, so the tile
/// replaces the notifications tile (the app bar bell already carries that
/// count) for anyone who can open My tasks or the field plan. "My activity"
/// opens the activity history branch for anyone holding the history module.
///
/// Still absent, with the reason: the email line (many accounts carry a
/// synthetic login address, which would read as a real mailbox), Edit
/// profile / My activity (no screen or route), the three notification
/// toggles (`notification_preferences` exists but nothing honours it, so a
/// switch would do nothing), device biometrics and change password (no
/// implementation in this app), storage used (no measurement), "Last sync"
/// and "Assigned tasks" (see above), the settings gear (no settings route).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_signature_preview.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/checklist_approval_signature_pad.dart';
import 'package:tyre_pulse/features/auth/presentation/login_security_copy.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_workspace_panel.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/notifications/presentation/notifications_copy.dart';
import 'package:tyre_pulse/features/problem_report/presentation/report_problem_screen.dart';
import 'package:tyre_pulse/features/profile/data/account_deletion_repository.dart';
import 'package:tyre_pulse/features/profile/data/saved_signature_repository.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

/// Stable finders for Profile's responsive visual regions.
@visibleForTesting
abstract final class ProfileScreenKeys {
  static const Key hero = Key('profile.hero');
  static const Key status = Key('profile.status');
  static const Key access = Key('profile.access');
  static const Key account = Key('profile.account');
  static const Key notificationsBadge = Key('profile.notifications.badge');
  static const Key languageRow = Key('profile.language');
  static const Key themeRow = Key('profile.theme');
  static const Key pendingSyncRow = Key('profile.pendingSync');
  static const Key appVersionRow = Key('profile.appVersion');
  static const Key signOut = Key('profile.signOut');
  static const Key unsyncedFooter = Key('profile.unsyncedFooter');
  static const Key verifiedBadge = Key('profile.verified');
  static const Key draftsTile = Key('profile.drafts');
  static const Key assignedTile = Key('profile.assigned');
  static const Key myActivity = Key('profile.myActivity');
  static const Key checklistLanguageRow = Key('profile.checklistLanguage');
  static const Key rolesRow = Key('profile.roles');
  static const Key countryRow = Key('profile.country');
  static const Key siteRow = Key('profile.site');
  static const Key signatureRow = Key('profile.signature');
  static const Key offlineDraftsRow = Key('profile.offlineDrafts');
  static const Key signatureSheet = Key('profile.signatureSheet');
  static const Key signaturePaper = Key('profile.signatureSheet.paper');
  static const Key signatureError = Key('profile.signatureSheet.error');
  static const Key signatureRedraw = Key('profile.signatureSheet.redraw');
  static const Key signatureSave = Key('profile.signatureSheet.save');
  static const Key signatureCancel = Key('profile.signatureSheet.cancel');
  static const Key signatureRemove = Key('profile.signatureSheet.remove');
  static const Key signatureRetry = Key('profile.signatureSheet.retry');
  static const Key reportProblemRow = Key('profile.reportProblem');
}

/// The three languages the app ships (en/ar/ur ARB catalogs). Names are the
/// languages' own endonyms - identical in every locale, so not translated -
/// matching the login screen's language control.
const List<({Locale locale, String label})> _kLanguages =
    <({Locale locale, String label})>[
  (locale: Locale('en'), label: 'English'),
  (locale: Locale('ar'), label: 'العربية'),
  (locale: Locale('ur'), label: 'اردو'),
];

/// The three theme choices [themeModeProvider] accepts, in picker order.
const List<ThemeMode> _kThemeModes = <ThemeMode>[
  ThemeMode.light,
  ThemeMode.dark,
  ThemeMode.system,
];

String _themeLabel(ThemeMode mode, AppLocalizations l10n) {
  return switch (mode) {
    ThemeMode.light => l10n.profileThemeLight,
    ThemeMode.dark => l10n.profileThemeDark,
    ThemeMode.system => l10n.profileThemeSystem,
  };
}

String _languageLabel(Locale locale) {
  for (final ({Locale locale, String label}) option in _kLanguages) {
    if (option.locale.languageCode == locale.languageCode) return option.label;
  }
  return locale.languageCode;
}

/// Mirrors `login_screen.dart`'s `visibleVersion`: the `999.0.0` fallback and
/// a blank value are not a real build version and are not shown.
String? _visibleVersion(String configured) =>
    configured == '999.0.0' || configured.trim().isEmpty ? null : configured;

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
    // `AuthController.signOut()` never throws - see its own library comment.
    // The router's redirect unmounts this screen once the signedOut session
    // reaches it; `_isSigningOut` only needs clearing for the frame or two
    // before that happens.
    await ref.read(authControllerProvider.notifier).signOut();
    if (mounted) {
      setState(() => _isSigningOut = false);
    }
  }

  Future<void> _chooseLanguage(Locale active) async {
    final Locale? chosen = await showModalBottomSheet<Locale>(
      context: context,
      useSafeArea: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (final ({Locale locale, String label}) option in _kLanguages)
              ListTile(
                key: Key('profile.language.${option.locale.languageCode}'),
                leading: const Icon(Icons.translate_rounded),
                title: Text(option.label),
                trailing: option.locale.languageCode == active.languageCode
                    ? Icon(
                        Icons.check_rounded,
                        color: TpPalette.of(sheetContext).primary,
                      )
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(option.locale),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    ref.read(localeProvider.notifier).setLocale(chosen);
  }

  Future<void> _chooseTheme(ThemeMode active) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeMode? chosen = await showModalBottomSheet<ThemeMode>(
      context: context,
      useSafeArea: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (final ThemeMode mode in _kThemeModes)
              ListTile(
                key: Key('profile.theme.${mode.name}'),
                leading: Icon(
                  switch (mode) {
                    ThemeMode.light => Icons.light_mode_outlined,
                    ThemeMode.dark => Icons.dark_mode_outlined,
                    ThemeMode.system => Icons.brightness_auto_outlined,
                  },
                ),
                title: Text(_themeLabel(mode, l10n)),
                trailing: mode == active
                    ? Icon(
                        Icons.check_rounded,
                        color: TpPalette.of(sheetContext).primary,
                      )
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(mode),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    ref.read(themeModeProvider.notifier).setMode(chosen);
  }

  Future<void> _chooseChecklistLanguage(String active) async {
    final String? chosen = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            for (final ChecklistLang lang in kChecklistLangs)
              ListTile(
                key: Key('profile.checklistLanguage.${lang.code}'),
                leading: const Icon(Icons.article_outlined),
                title: Text(lang.native),
                trailing: lang.code == active
                    ? Icon(
                        Icons.check_rounded,
                        color: TpPalette.of(sheetContext).primary,
                      )
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(lang.code),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    ref.read(checklistContentLanguageProvider.notifier).select(chosen);
  }

  Future<void> _openSavedSignature() async {
    await showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => const _SavedSignatureSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AuthState authState = ref.watch(authControllerProvider);
    final WorkspaceProfile? profile = authState.profile;
    final AsyncValue<int> unread = ref.watch(unreadNotificationsCountProvider);
    final int unreadCount = unread.asData?.value ?? 0;
    final TpPalette palette = TpPalette.of(context);

    return TpScaffold(
      // No back fallback: Profile is anchored - the root of its own branch,
      // exactly like Home.
      appBar: AppBar(
        automaticallyImplyLeading: false,
        titleSpacing: TpSpace.lg,
        title: const TpBrandLockup(),
        actions: <Widget>[
          IconButton(
            icon: Badge(
              key: ProfileScreenKeys.notificationsBadge,
              isLabelVisible: unreadCount > 0,
              backgroundColor: palette.warning.base,
              textColor: palette.warning.onBase,
              label: Text(unreadCount > 99 ? '99+' : '$unreadCount'),
              child: const Icon(Icons.notifications_none_rounded),
            ),
            tooltip: NotificationsCopy.of(context)('title'),
            onPressed: () => context.push(const NotificationsRoute().location),
          ),
          const SizedBox(width: TpSpace.sm),
        ],
      ),
      body: profile == null
          // Reachable only outside the normal shell flow (the shell never
          // renders this branch until a profile is loaded) - most concretely
          // a widget test mounting this screen before a session resolves.
          ? const TpLoadingState()
          : _buildBody(context, authState, profile),
    );
  }

  Widget _buildBody(
    BuildContext context,
    AuthState authState,
    WorkspaceProfile profile,
  ) {
    final AsyncValue<int> pendingSync =
        ref.watch(profilePendingSyncCountProvider);
    final AsyncValue<int> unread = ref.watch(unreadNotificationsCountProvider);
    final Locale activeLocale =
        ref.watch(localeProvider) ?? Localizations.localeOf(context);
    final ThemeMode activeTheme = ref.watch(themeModeProvider);
    final String? version =
        _visibleVersion(ref.watch(currentAppVersionProvider));
    final AsyncValue<int> drafts = ref.watch(profileDraftCountProvider);
    final String checklistLanguage =
        ref.watch(checklistContentLanguageProvider);
    final AsyncValue<SavedSignatureLookup> savedSignature =
        ref.watch(mySavedSignatureLookupProvider);
    final String? currency = ref.watch(workspaceContextProvider)?.currency;
    final int moduleCount = ref.watch(allowedModulesProvider).length;
    // Same resolver as `canAccessModuleProvider`, read as one set.
    final Set<ModuleKey> allowed = ref.watch(allowedModulesProvider);
    final bool canSeeTasks = allowed.contains(ModuleKey.tasks);
    final bool canSeeCalendar = allowed.contains(ModuleKey.calendar);
    final bool canSeeHistory = allowed.contains(ModuleKey.history);
    // "Assigned tasks" (mock 19): the same personal snapshot "My tasks"
    // renders, read only when the person can open that list.
    final AsyncValue<MyWorkSnapshot>? assigned = canSeeTasks || canSeeCalendar
        ? ref.watch(myWorkSnapshotProvider)
        : null;

    return LayoutBuilder(
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
                    _IdentityHeader(profile: profile),
                    if (canSeeHistory) ...<Widget>[
                      const SizedBox(height: TpSpace.md),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TpButton(
                          key: ProfileScreenKeys.myActivity,
                          label: AppLocalizations.of(context).profileMyActivity,
                          icon: Icons.insights_outlined,
                          variant: TpButtonVariant.secondary,
                          isCompact: true,
                          onPressed: () =>
                              context.go(const ActivityHistoryRoute().location),
                        ),
                      ),
                    ],
                    const SizedBox(height: TpSpace.md),
                    const DriverWorkspaceEntry(),
                    const SizedBox(height: TpSpace.md),
                    _ProfileStatusStrip(
                      drafts: drafts,
                      pendingSync: pendingSync,
                      unread: unread,
                      assigned: assigned,
                      onOpenAssigned: canSeeTasks
                          ? () => context.push(const TasksRoute().location)
                          : () => context.push(const CalendarRoute().location),
                      profileStale: authState.profileStale,
                    ),
                    const SizedBox(height: TpSpace.lg),
                    _ProfileGroups(
                      settings: _SettingsColumn(
                        profile: profile,
                        activeLocale: activeLocale,
                        activeTheme: activeTheme,
                        pendingSync: pendingSync,
                        drafts: drafts,
                        version: version,
                        currency: currency,
                        moduleCount: moduleCount,
                        checklistLanguage: checklistLanguage,
                        savedSignature: savedSignature,
                        onChooseLanguage: () =>
                            unawaited(_chooseLanguage(activeLocale)),
                        onChooseTheme: () =>
                            unawaited(_chooseTheme(activeTheme)),
                        onChooseChecklistLanguage: () => unawaited(
                          _chooseChecklistLanguage(checklistLanguage),
                        ),
                        onOpenSignature: () => unawaited(_openSavedSignature()),
                        onReportProblem: () => unawaited(
                          openReportProblem(
                            context,
                            sourceScreen: const ProfileRoute().location,
                          ),
                        ),
                      ),
                      account: _AccountBlock(
                        isSigningOut: _isSigningOut,
                        pendingSync: pendingSync,
                        onSignOut: () => unawaited(_confirmAndSignOut()),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The open identity header: large initials avatar, name, labelled role,
/// employee ID and site · country. No card, matching the mock. Only verified
/// `profiles` columns are rendered - the mock's email line is absent because
/// [WorkspaceProfile] does not carry an email.
class _IdentityHeader extends StatelessWidget {
  const _IdentityHeader({required this.profile});

  final WorkspaceProfile profile;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final String? name = profile.fullName;
    // Organisation wide scope ('ALL') means every site, not none.
    final String site = (profile.legacySite?.trim().isNotEmpty ?? false)
        ? profile.legacySite!.trim()
        : profile.siteScope.isOrganisationWide
            ? l10n.homeSiteAllSites
            : l10n.homeSiteStatUnavailable;
    final List<String> countries = profile.countryScope.seesAllCountries
        ? const <String>[]
        : profile.countryScope.namedCountries;
    final String location =
        countries.isEmpty ? site : '$site · ${countries.join(', ')}';

    return Padding(
      key: ProfileScreenKeys.hero,
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Stack(
            clipBehavior: Clip.none,
            children: <Widget>[
              // A brand ring around a soft two-tone initials disc,
              // separated by a background-coloured gap so the ring reads as
              // a ring on either theme.
              Container(
                width: 100,
                height: 100,
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: palette.primary,
                  boxShadow: <BoxShadow>[
                    BoxShadow(
                      color: palette.primary.withValues(alpha: 0.18),
                      blurRadius: 16,
                    ),
                  ],
                ),
                child: Container(
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: palette.background,
                  ),
                  child: Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: <Color>[palette.primarySoft, palette.info.soft],
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      _profileInitials(name),
                      style: text.headlineMedium?.copyWith(
                        color: palette.primaryDark,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ),
              ),
              PositionedDirectional(
                end: 4,
                bottom: 6,
                child: Container(
                  width: 20,
                  height: 20,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: profile.isLocked
                        ? palette.critical.base
                        : palette.ok.base,
                    border: Border.all(color: palette.background, width: 3),
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
                  style: text.headlineSmall?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.3,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: TpSpace.sm),
                if (profile.employeeId != null) ...<Widget>[
                  _IdentityLine(
                    icon: Icons.person_outline_rounded,
                    label: l10n.profileEmployeeIdLabel,
                    value: profile.employeeId!,
                  ),
                  const SizedBox(height: 3),
                ],
                _IdentityLine(
                  icon: Icons.work_outline_rounded,
                  label: l10n.profileRoleLabel,
                  value: profile.role.displayName,
                ),
                const SizedBox(height: 3),
                _IdentityLine(
                  icon: Icons.location_on_outlined,
                  value: location,
                ),
                if (profile.isApproved && !profile.isLocked) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Row(
                    key: ProfileScreenKeys.verifiedBadge,
                    children: <Widget>[
                      Icon(
                        Icons.verified_user_outlined,
                        size: 16,
                        color: palette.ok.base,
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          l10n.clMockProfileVerified,
                          style:
                              Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    color: palette.ok.base,
                                    fontWeight: FontWeight.w700,
                                  ),
                        ),
                      ),
                    ],
                  ),
                ],
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
    this.label,
  });

  final IconData icon;
  final String value;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? base = Theme.of(context).textTheme.bodyMedium;
    return Row(
      children: <Widget>[
        Icon(icon, size: 16, color: palette.primary),
        const SizedBox(width: 6),
        if (label != null) ...<Widget>[
          Text(label!, style: base?.copyWith(color: palette.textSecondary)),
          const SizedBox(width: TpSpace.sm),
        ],
        Flexible(
          child: Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: base?.copyWith(
              color: palette.text,
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
  if (words.isEmpty) return '-';
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

/// A count as shown in the strip: the number when read, `-` otherwise.
String _countText(AsyncValue<int> value) {
  final int? count = value.asData?.value;
  return count == null ? '-' : '$count';
}

/// Real items only: open work assigned to this person (when they can open
/// that list), queued work still on this device, unread notifications (when
/// there is no assigned-work tile), and - only when the profile itself is served from the offline cache - an
/// offline marker. No invented task count or "last sync" clock.
class _ProfileStatusStrip extends StatelessWidget {
  const _ProfileStatusStrip({
    required this.drafts,
    required this.pendingSync,
    required this.unread,
    required this.profileStale,
    this.assigned,
    this.onOpenAssigned,
  });

  final AsyncValue<int> drafts;
  final AsyncValue<int> pendingSync;
  final AsyncValue<int> unread;
  final bool profileStale;

  /// Open work assigned to this person; null when they cannot open the list,
  /// in which case the notifications count keeps its place.
  final AsyncValue<MyWorkSnapshot>? assigned;
  final VoidCallback? onOpenAssigned;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final int? pending = pendingSync.asData?.value;
    final int? unreadCount = unread.asData?.value;

    return TpCard(
      key: ProfileScreenKeys.status,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.md,
      ),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final int tiles = (assigned != null ? 1 : 0) +
              2 +
              (assigned == null ? 1 : 0) +
              (profileStale ? 1 : 0);
          final bool stacked = constraints.maxWidth / tiles < 136;
          return IntrinsicHeight(
            child: Row(
              children: <Widget>[
                if (assigned
                    case final AsyncValue<MyWorkSnapshot> work) ...<Widget>[
                  Expanded(
                    child: InkWell(
                      onTap: onOpenAssigned,
                      borderRadius: BorderRadius.circular(TpRadius.md),
                      child: _ProfileStatusItem(
                        key: ProfileScreenKeys.assignedTile,
                        icon: Icons.assignment_outlined,
                        value: switch (work) {
                          AsyncData<MyWorkSnapshot>(:final value) => () {
                              final int n = value.items
                                  .where((item) => item.isOpen)
                                  .length;
                              return value.partial ? '$n+' : '$n';
                            }(),
                          _ => '-',
                        },
                        label: l10n.profileAssignedTasks,
                        tone: palette.ok,
                        stacked: stacked,
                      ),
                    ),
                  ),
                  VerticalDivider(
                    width: 1,
                    thickness: 1,
                    color: palette.border,
                  ),
                ],
                Expanded(
                  child: _ProfileStatusItem(
                    key: ProfileScreenKeys.draftsTile,
                    icon: Icons.description_outlined,
                    value: _countText(drafts),
                    label: l10n.clMockPendingDrafts,
                    tone: (drafts.asData?.value ?? 0) > 0
                        ? palette.warning
                        : palette.info,
                    stacked: stacked,
                  ),
                ),
                VerticalDivider(width: 1, thickness: 1, color: palette.border),
                Expanded(
                  child: _ProfileStatusItem(
                    icon: Icons.cloud_upload_outlined,
                    value: _countText(pendingSync),
                    label: l10n.homeSyncStatLabel,
                    tone: pending == null
                        ? palette.neutral
                        : pending > 0
                            ? palette.warning
                            : palette.ok,
                    stacked: stacked,
                  ),
                ),
                // The bell in the app bar already carries the unread count; the
                // tile only keeps its place when there is no assigned-work tile.
                if (assigned == null) ...<Widget>[
                  VerticalDivider(
                    width: 1,
                    thickness: 1,
                    color: palette.border,
                  ),
                  Expanded(
                    child: _ProfileStatusItem(
                      icon: Icons.notifications_none_rounded,
                      value: _countText(unread),
                      label: NotificationsCopy.of(context)('title'),
                      tone: (unreadCount ?? 0) > 0
                          ? palette.critical
                          : palette.info,
                      stacked: stacked,
                    ),
                  ),
                ],
                if (profileStale) ...<Widget>[
                  VerticalDivider(
                    width: 1,
                    thickness: 1,
                    color: palette.border,
                  ),
                  Expanded(
                    child: _ProfileStatusItem(
                      icon: Icons.cloud_off_outlined,
                      value: l10n.offlineTitle,
                      label: l10n.stateOfflineCachedTitle,
                      tone: palette.warning,
                      stacked: stacked,
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ProfileStatusItem extends StatelessWidget {
  const _ProfileStatusItem({
    required this.icon,
    required this.label,
    required this.value,
    required this.tone,
    this.stacked = false,
    super.key,
  });

  final IconData icon;
  final String label;
  final String value;
  final TpStatusColors tone;

  /// Icon above the number and label, for a tile too narrow to hold both
  /// side by side (see [_ProfileStatusStrip]).
  final bool stacked;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    {
      {
        // Three or four tiles share a phone-width strip. Beside a 44pt icon
        // a label like "Pending drafts" has under 60pt left and breaks in
        // the middle of a word, so a narrow tile stacks the icon above the
        // number and label instead.
        if (stacked) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: tone.soft,
                    borderRadius: BorderRadius.circular(TpRadius.md),
                  ),
                  alignment: Alignment.center,
                  child: Icon(icon, size: 20, color: tone.base),
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: text.titleLarge?.copyWith(
                    color: tone.base,
                    fontWeight: FontWeight.w900,
                    height: 1.1,
                  ),
                ),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: text.labelSmall?.copyWith(
                    color: TpPalette.of(context).textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          );
        }
        return _wide(context, text);
      }
    }
  }

  Widget _wide(BuildContext context, TextTheme text) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: tone.soft,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: TpSizing.iconMd, color: tone.base),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleLarge?.copyWith(
                    color: tone.base,
                    fontWeight: FontWeight.w900,
                    height: 1.1,
                  ),
                ),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.labelSmall?.copyWith(
                    color: TpPalette.of(context).textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Settings beside the account block on a wide layout, stacked on a phone.
class _ProfileGroups extends StatelessWidget {
  const _ProfileGroups({required this.settings, required this.account});

  final Widget settings;
  final Widget account;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        if (constraints.maxWidth >= 720) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(flex: 3, child: settings),
              const SizedBox(width: TpSpace.lg),
              Expanded(flex: 2, child: account),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            settings,
            const SizedBox(height: TpSpace.lg),
            account,
          ],
        );
      },
    );
  }
}

class _SettingsColumn extends StatelessWidget {
  const _SettingsColumn({
    required this.profile,
    required this.activeLocale,
    required this.activeTheme,
    required this.pendingSync,
    required this.drafts,
    required this.version,
    required this.currency,
    required this.moduleCount,
    required this.checklistLanguage,
    required this.savedSignature,
    required this.onChooseLanguage,
    required this.onChooseTheme,
    required this.onChooseChecklistLanguage,
    required this.onOpenSignature,
    required this.onReportProblem,
  });

  final WorkspaceProfile profile;
  final Locale activeLocale;
  final ThemeMode activeTheme;
  final AsyncValue<int> pendingSync;
  final AsyncValue<int> drafts;
  final String? version;

  /// The server-resolved currency of the active workspace, or null (never
  /// defaulted - see `workspace_context.dart`).
  final String? currency;
  final int moduleCount;
  final String checklistLanguage;
  final AsyncValue<SavedSignatureLookup> savedSignature;
  final VoidCallback onChooseLanguage;
  final VoidCallback onChooseTheme;
  final VoidCallback onChooseChecklistLanguage;
  final VoidCallback onOpenSignature;
  final VoidCallback onReportProblem;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final LoginSecurityCopy loginCopy = LoginSecurityCopy.of(context);
    final String countries = _countryScopeLabel(profile, l10n);
    final int? pending = pendingSync.asData?.value;
    final int? draftCount = drafts.asData?.value;
    final String locale = Localizations.localeOf(context).toLanguageTag();
    final bool signatureUnknown = savedSignature.hasError ||
        savedSignature.asData?.value.status == SavedSignatureStatus.unavailable;
    final String signatureValue = savedSignature.when(
      loading: () => l10n.stateLoading,
      error: (Object e, StackTrace st) => l10n.valueUnavailable,
      data: (SavedSignatureLookup lookup) {
        final SavedSignature? value = lookup.signature;
        if (lookup.status == SavedSignatureStatus.unavailable) {
          return l10n.profileFixSignatureCouldNotCheck;
        }
        if (value == null) return l10n.clMockSignatureNotSaved;
        final DateTime? at = value.updatedAt?.toLocal();
        return at == null
            ? l10n.clMockSignatureCaptured
            : l10n.clMockSignatureCapturedOn(
                DateFormat('d MMM', locale).format(at),
              );
      },
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _SettingsSection(
          key: ProfileScreenKeys.access,
          title: l10n.profileSectionWorkspace,
          rows: <Widget>[
            _SettingsRow(
              key: ProfileScreenKeys.siteRow,
              icon: Icons.location_city_outlined,
              tone: palette.warning,
              label: l10n.clMockActiveSite,
              value: _siteScopeLabel(profile, l10n),
            ),
            _SettingsRow(
              key: ProfileScreenKeys.countryRow,
              icon: Icons.public_outlined,
              tone: palette.ok,
              label: l10n.clMockCountryCurrency,
              value: currency == null || currency!.trim().isEmpty
                  ? countries
                  : '$countries · ${currency!.trim()}',
            ),
            _SettingsRow(
              key: ProfileScreenKeys.rolesRow,
              icon: Icons.groups_outlined,
              tone: palette.info,
              label: l10n.clMockRolesAccess,
              // The role is the server's catalogue name (Latin script); a
              // first-strong isolate keeps it from pulling the module count
              // out of order inside an Arabic or Urdu row.
              value: '\u2068${profile.role.displayName}\u2069 · '
                  '${l10n.clMockModuleCount(moduleCount)}',
            ),
          ],
        ),
        const SizedBox(height: TpSpace.lg),
        _SettingsSection(
          title: l10n.profileSectionDisplay,
          rows: <Widget>[
            _SettingsRow(
              key: ProfileScreenKeys.languageRow,
              icon: Icons.translate_rounded,
              tone: palette.unknown,
              label: l10n.profileLanguageLabel,
              value: _languageLabel(activeLocale),
              onTap: onChooseLanguage,
            ),
            _SettingsRow(
              key: ProfileScreenKeys.checklistLanguageRow,
              icon: Icons.article_outlined,
              tone: palette.info,
              label: l10n.clMockChecklistLanguage,
              value: langMeta(checklistLanguage).native,
              caption: l10n.clMockChecklistLanguageCaption,
              onTap: onChooseChecklistLanguage,
            ),
            _SettingsRow(
              key: ProfileScreenKeys.themeRow,
              icon: Icons.contrast_rounded,
              tone: palette.info,
              label: l10n.profileThemeLabel,
              value: _themeLabel(activeTheme, l10n),
              onTap: onChooseTheme,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.lg),
        _SettingsSection(
          title: l10n.clMockSectionSecurity,
          rows: <Widget>[
            _SettingsRow(
              key: ProfileScreenKeys.signatureRow,
              icon: Icons.draw_outlined,
              tone: palette.ok,
              label: l10n.clMockSavedSignature,
              value: signatureValue,
              valueColor: signatureUnknown ? palette.textMuted : null,
              onTap: onOpenSignature,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.lg),
        _SettingsSection(
          title: l10n.profileSectionOffline,
          rows: <Widget>[
            _SettingsRow(
              key: ProfileScreenKeys.pendingSyncRow,
              icon: Icons.cloud_sync_outlined,
              tone: pending == null
                  ? palette.neutral
                  : pending == 0
                      ? palette.ok
                      : palette.warning,
              label: l10n.homeSyncStatLabel,
              value: pending == null
                  ? l10n.valueUnavailable
                  : pending == 0
                      ? l10n.syncAllSynced
                      : l10n.syncPendingChanges(pending),
              valueColor: pending == null
                  ? palette.textMuted
                  : pending == 0
                      ? palette.ok.base
                      : palette.warning.base,
            ),
            _SettingsRow(
              key: ProfileScreenKeys.offlineDraftsRow,
              icon: Icons.description_outlined,
              tone: (draftCount ?? 0) > 0 ? palette.warning : palette.neutral,
              label: l10n.clMockOfflineDrafts,
              value: draftCount == null
                  ? l10n.valueUnavailable
                  : l10n.clMockDraftsStored(draftCount),
              valueColor: draftCount == null
                  ? palette.textMuted
                  : draftCount > 0
                      ? palette.warning.base
                      : null,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.lg),
        _SettingsSection(
          title: l10n.problemReportSectionHelp,
          rows: <Widget>[
            _SettingsRow(
              key: ProfileScreenKeys.reportProblemRow,
              icon: Icons.support_agent_rounded,
              tone: palette.info,
              label: l10n.problemReportAction,
              onTap: onReportProblem,
            ),
          ],
        ),
        if (version != null) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          _SettingsSection(
            rows: <Widget>[
              _SettingsRow(
                key: ProfileScreenKeys.appVersionRow,
                icon: Icons.info_outline_rounded,
                tone: palette.neutral,
                label: loginCopy.version(version!),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// View, replace or remove the person's own saved signature (V601).
///
/// A write is an explicit, ONLINE action (see the repository's library
/// comment): failures are said out loud, never swallowed. Removing asks
/// first. Nothing here signs anything - the saved mark is only ever
/// pre-filled into an approval pad the reviewer still has to press.
class _SavedSignatureSheet extends ConsumerStatefulWidget {
  const _SavedSignatureSheet();

  @override
  ConsumerState<_SavedSignatureSheet> createState() =>
      _SavedSignatureSheetState();
}

class _SavedSignatureSheetState extends ConsumerState<_SavedSignatureSheet> {
  bool _drawing = false;
  bool _busy = false;
  String? _drawn;
  String? _error;

  Future<void> _save() async {
    final String? value = _drawn;
    if (value == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(savedSignatureRepositoryProvider).save(value);
      ref.invalidate(mySavedSignatureLookupProvider);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _drawing = false;
        _drawn = null;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = AppLocalizations.of(context).clMockSignatureSaveFailed;
      });
    }
  }

  Future<void> _remove() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool confirmed = await TpDialog.confirm(
      context: context,
      title: l10n.clMockSignatureRemoveTitle,
      message: l10n.clMockSignatureRemoveMessage,
      cancelLabel: l10n.actionCancel,
      confirmLabel: l10n.clMockSignatureRemove,
      isDestructive: true,
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(savedSignatureRepositoryProvider).clear();
      ref.invalidate(mySavedSignatureLookupProvider);
      if (!mounted) return;
      setState(() => _busy = false);
    } on Object {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = l10n.profileFixSignatureRemoveFailed;
      });
    }
  }

  /// Leaves drawing mode without saving; the stored signature is untouched.
  void _cancelDrawing() {
    setState(() {
      _drawing = false;
      _drawn = null;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final AsyncValue<SavedSignatureLookup> saved =
        ref.watch(mySavedSignatureLookupProvider);
    final SavedSignature? current = saved.asData?.value.signature;
    // A failed read is NOT "nothing saved": the paper says so, and Remove is
    // not offered for a state we could not see (Try again re-reads instead).
    final bool unavailable = saved.hasError ||
        saved.asData?.value.status == SavedSignatureStatus.unavailable;
    // The signature is dark ink on paper in every theme, so the preview
    // always sits on the LIGHT palette's surface, never on a dark card.
    const TpPalette paper = TpPalette.light;

    return Padding(
      key: ProfileScreenKeys.signatureSheet,
      padding: EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            l10n.clMockSavedSignature,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            l10n.clMockSignatureSheetHint,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textSecondary),
          ),
          const SizedBox(height: TpSpace.md),
          if (_drawing)
            ChecklistApprovalSignaturePad(
              onChanged: (ChecklistApprovalSignatureCapture? capture) =>
                  setState(() => _drawn = capture?.dataUrl),
            )
          else if (saved.isLoading)
            const SizedBox(height: 140, child: TpLoadingState())
          else
            Container(
              key: ProfileScreenKeys.signaturePaper,
              height: 140,
              decoration: BoxDecoration(
                color: paper.surface,
                borderRadius: BorderRadius.circular(TpRadius.md),
                border: Border.all(color: palette.border),
              ),
              alignment: Alignment.center,
              child: current == null
                  ? Text(
                      unavailable
                          ? l10n.profileFixSignatureCouldNotCheck
                          : l10n.clMockSignatureNotSaved,
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: paper.textMuted),
                    )
                  : ApprovalSignaturePreview(
                      value: current.value,
                      fallback: Text(l10n.checklistApprovalSignatureSavedLabel),
                    ),
            ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              _error!,
              key: ProfileScreenKeys.signatureError,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.critical.base),
            ),
          ],
          const SizedBox(height: TpSpace.md),
          if (_drawing) ...<Widget>[
            TpButton.primary(
              key: ProfileScreenKeys.signatureSave,
              label: l10n.clMockSignatureSave,
              icon: Icons.save_outlined,
              isBusy: _busy,
              onPressed: _drawn == null || _busy ? null : _save,
            ),
            const SizedBox(height: TpSpace.sm),
            TpButton.text(
              key: ProfileScreenKeys.signatureCancel,
              label: l10n.actionCancel,
              onPressed: _busy ? null : _cancelDrawing,
            ),
          ] else ...<Widget>[
            TpButton.primary(
              key: ProfileScreenKeys.signatureRedraw,
              label: l10n.checklistApprovalSignatureRedraw,
              icon: Icons.edit_outlined,
              onPressed: _busy ? null : () => setState(() => _drawing = true),
            ),
            if (unavailable) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              TpButton.secondary(
                key: ProfileScreenKeys.signatureRetry,
                label: l10n.actionRetry,
                icon: Icons.refresh_rounded,
                onPressed: _busy
                    ? null
                    : () => ref.invalidate(mySavedSignatureLookupProvider),
              ),
            ],
            if (current != null) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              TpButton.danger(
                key: ProfileScreenKeys.signatureRemove,
                label: l10n.clMockSignatureRemove,
                icon: Icons.delete_outline_rounded,
                isBusy: _busy,
                onPressed: _busy ? null : _remove,
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// A section: header text outside the rows, rows in one bordered group,
/// separated by hairline dividers.
class _SettingsSection extends StatelessWidget {
  const _SettingsSection({required this.rows, this.title, super.key});

  final String? title;
  final List<Widget> rows;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (title != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(
              start: TpSpace.xs,
              bottom: TpSpace.sm,
            ),
            child: Row(
              children: <Widget>[
                Container(
                  width: 4,
                  height: 16,
                  decoration: BoxDecoration(
                    color: palette.primary,
                    borderRadius: BorderRadius.circular(TpRadius.pill),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Text(
                    title!,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w900,
                        ),
                  ),
                ),
              ],
            ),
          ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: palette.surface,
            borderRadius: BorderRadius.circular(TpRadius.lg),
            border: Border.all(color: palette.border),
            // Depth only in light: a shadow tinted from white text would
            // glow on the dark theme.
            boxShadow: palette.brightness == Brightness.light
                ? <BoxShadow>[
                    BoxShadow(
                      color: palette.text.withValues(alpha: 0.05),
                      blurRadius: 12,
                      offset: const Offset(0, 3),
                    ),
                  ]
                : null,
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(TpRadius.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                for (int i = 0; i < rows.length; i++) ...<Widget>[
                  if (i > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      indent: 64,
                      color: palette.border,
                    ),
                  rows[i],
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// A dense settings row. A chevron is shown ONLY when [onTap] opens
/// something real; a row that merely reports a fact is not a button.
class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    required this.icon,
    required this.tone,
    required this.label,
    this.value,
    this.valueColor,
    this.caption,
    this.onTap,
    super.key,
  });

  final IconData icon;
  final TpStatusColors tone;
  final String label;
  final String? value;

  /// A second, quieter line under [value].
  final String? caption;
  final Color? valueColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    final Widget content = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 56),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: TpSpace.sm,
        ),
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) => Row(
            children: <Widget>[
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: tone.soft,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Icon(icon, size: 20, color: tone.base),
              ),
              const SizedBox(width: TpSpace.md),
              // The label takes whatever the value does not need, so a short
              // value ("All", "Light") never squeezes the label onto several
              // lines; a long value is capped at just under half the row.
              Expanded(
                child: Text(
                  label,
                  style: text.bodyMedium?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (value != null) ...<Widget>[
                const SizedBox(width: TpSpace.md),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxWidth: constraints.maxWidth * 0.45,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        value!,
                        textAlign: TextAlign.end,
                        style: text.bodyMedium?.copyWith(
                          color: valueColor ?? palette.textSecondary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (caption != null)
                        Text(
                          caption!,
                          textAlign: TextAlign.end,
                          style: text.labelSmall?.copyWith(
                            color: palette.textMuted,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
              if (onTap != null) ...<Widget>[
                const SizedBox(width: TpSpace.xs),
                Icon(
                  Icons.chevron_right_rounded,
                  size: TpSizing.iconMd,
                  color: palette.primary,
                ),
              ],
            ],
          ),
        ),
      ),
    );

    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      child: InkWell(onTap: onTap, child: content),
    );
  }
}

/// Full-width outlined red sign-out, plus an orange line while work is still
/// queued - or while the queue could not be read, because an unknown count
/// may be hiding unsynced work and must not read as "all clear".
class _AccountBlock extends StatelessWidget {
  const _AccountBlock({
    required this.isSigningOut,
    required this.pendingSync,
    required this.onSignOut,
  });

  final bool isSigningOut;
  final AsyncValue<int> pendingSync;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final Color danger = palette.critical.base;
    final int? queued = pendingSync.asData?.value;
    final bool unknown = queued == null && pendingSync.hasError;
    final bool showFooter = unknown || (queued ?? 0) > 0;

    return Column(
      key: ProfileScreenKeys.account,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SizedBox(
          height: 52,
          child: OutlinedButton.icon(
            key: ProfileScreenKeys.signOut,
            onPressed: isSigningOut ? null : onSignOut,
            style: OutlinedButton.styleFrom(
              foregroundColor: danger,
              backgroundColor: palette.critical.soft.withValues(alpha: 0.45),
              side: BorderSide(color: danger, width: 1.5),
              textStyle: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(TpRadius.md),
              ),
            ),
            icon: isSigningOut
                ? SizedBox(
                    width: TpSizing.iconSm,
                    height: TpSizing.iconSm,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: danger,
                    ),
                  )
                : const Icon(Icons.logout_rounded),
            label: Text(l10n.actionSignOut),
          ),
        ),
        if (showFooter) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Row(
            key: ProfileScreenKeys.unsyncedFooter,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(
                Icons.info_outline_rounded,
                size: TpSizing.iconSm,
                color: palette.warning.base,
              ),
              const SizedBox(width: TpSpace.xs),
              Flexible(
                child: Text(
                  unknown
                      ? l10n.profileSyncUnknownFooter
                      : l10n.profileUnsyncedFooter,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.warning.base,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: TpSpace.md),
        const _AccountDeletionButton(),
      ],
    );
  }
}

/// "Delete my account" - Expo parity (`mobile/app/(app)/profile.tsx` danger
/// zone + `mobile/lib/accountDeletion.ts`), and the Play in-app deletion
/// path. Records a REQUEST only; typing the confirm word is required first.
class _AccountDeletionButton extends ConsumerStatefulWidget {
  const _AccountDeletionButton();

  @override
  ConsumerState<_AccountDeletionButton> createState() =>
      _AccountDeletionButtonState();
}

class _AccountDeletionButtonState
    extends ConsumerState<_AccountDeletionButton> {
  Map<String, String> _copy(BuildContext context) => <String, String>{
        for (final String entry in AppLocalizations.of(context)
            .accountDeletionCopyCatalog
            .split('~'))
          if (entry.indexOf('=') > 0)
            entry.substring(0, entry.indexOf('=')):
                entry.substring(entry.indexOf('=') + 1),
      };

  Future<void> _open() async {
    final Map<String, String> copy = _copy(context);
    String t(String key) => copy[key] ?? key;
    final TextEditingController reason = TextEditingController();
    final TextEditingController confirm = TextEditingController();
    bool busy = false;
    String? problem;
    final AccountDeletionOutcome? outcome =
        await showDialog<AccountDeletionOutcome>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text(t('title')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(t('intro')),
                const SizedBox(height: TpSpace.sm),
                Text(t('what')),
                const SizedBox(height: TpSpace.sm),
                Text(t('timeline')),
                const SizedBox(height: TpSpace.md),
                TextField(
                  key: const Key('profile.deleteAccount.reason'),
                  controller: reason,
                  maxLines: 2,
                  decoration: InputDecoration(labelText: t('reason')),
                ),
                TextField(
                  key: const Key('profile.deleteAccount.confirm'),
                  controller: confirm,
                  decoration: InputDecoration(labelText: t('confirm')),
                ),
                if (problem != null) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  Text(
                    problem!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: busy ? null : () => Navigator.of(context).pop(),
              child: Text(t('cancel')),
            ),
            FilledButton(
              key: const Key('profile.deleteAccount.submit'),
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              onPressed: busy
                  ? null
                  : () async {
                      if (confirm.text.trim().toUpperCase() !=
                          t('word').toUpperCase()) {
                        setDialogState(() => problem = t('mismatch'));
                        return;
                      }
                      setDialogState(() {
                        busy = true;
                        problem = null;
                      });
                      final AccountDeletionOutcome result = await ref
                          .read(accountDeletionRepositoryProvider)
                          .request(reason: reason.text);
                      if (result == AccountDeletionOutcome.submitted) {
                        if (context.mounted) {
                          Navigator.of(context).pop(result);
                        }
                        return;
                      }
                      setDialogState(() {
                        busy = false;
                        problem = result == AccountDeletionOutcome.unavailable
                            ? t('unavailable')
                            : t('failed');
                      });
                    },
              child: Text(t('submit')),
            ),
          ],
        ),
      ),
    );
    reason.dispose();
    confirm.dispose();
    if (outcome != AccountDeletionOutcome.submitted || !mounted) return;
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(t('successTitle')),
        content: Text(t('successBody')),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(t('ok')),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, String> copy = _copy(context);
    final TpPalette palette = TpPalette.of(context);
    return TextButton.icon(
      key: const Key('profile.deleteAccount'),
      onPressed: () => unawaited(_open()),
      style: TextButton.styleFrom(foregroundColor: palette.critical.base),
      icon: const Icon(Icons.person_remove_outlined),
      label: Text(copy['title'] ?? 'title'),
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
