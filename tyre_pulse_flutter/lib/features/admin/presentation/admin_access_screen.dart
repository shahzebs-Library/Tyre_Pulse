/// `/admin/access` - per-person mobile module overrides.
///
/// Ported from `mobile/app/(app)/admin/access.tsx` + `mobile/lib/accessAdmin.ts`.
/// Overrides live in `user_access_grants` under the `mobile:` prefix, so they
/// never touch web access. The module list is the app's own
/// [ModuleRegistry] - not a fourth hand-kept copy of the TypeScript registry.
///
/// V225's unique key includes `effect`, so writing Allow over an existing Deny
/// would leave BOTH rows and the revoke would keep winning at every reader
/// (the defect the web AccessPreviewOverride shipped with). Switching an
/// override therefore clears the old row first, then writes the new one.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ui.dart';

/// The three choices per module.
enum AdminAccessChoice { roleDefault, allow, deny }

AdminAccessChoice adminChoiceFor(AdminMobileGrant? grant) =>
    switch (grant?.effect) {
      null => AdminAccessChoice.roleDefault,
      AdminGrantEffect.grant => AdminAccessChoice.allow,
      AdminGrantEffect.revoke => AdminAccessChoice.deny,
    };

class AdminAccessScreen extends ConsumerStatefulWidget {
  const AdminAccessScreen({required this.route, super.key});

  final AdminAccessRoute route;

  @override
  ConsumerState<AdminAccessScreen> createState() => _AdminAccessScreenState();
}

class _AdminAccessScreenState extends ConsumerState<AdminAccessScreen> {
  final TextEditingController _search = TextEditingController();
  List<AdminUser> _users = const <AdminUser>[];
  Object? _usersError;
  bool _usersLoading = true;

  AdminUser? _selected;
  Map<ModuleKey, AdminMobileGrant> _grants =
      const <ModuleKey, AdminMobileGrant>{};
  Object? _grantsError;
  bool _grantsLoading = false;
  ModuleKey? _busy;

  @override
  void initState() {
    super.initState();
    unawaited(_loadUsers());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  AdminRepository get _repo => ref.read(adminRepositoryProvider);

  Future<void> _loadUsers() async {
    setState(() {
      _usersLoading = true;
      _usersError = null;
    });
    try {
      final List<AdminUser> rows = await _repo.listUsers();
      if (!mounted) return;
      setState(() {
        _users = rows;
        _usersLoading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _usersError = error;
        _usersLoading = false;
      });
    }
  }

  Future<void> _select(AdminUser user) async {
    setState(() {
      _selected = user;
      _grants = const <ModuleKey, AdminMobileGrant>{};
    });
    await _loadGrants();
  }

  Future<void> _loadGrants() async {
    final AdminUser? user = _selected;
    if (user == null) return;
    setState(() {
      _grantsLoading = true;
      _grantsError = null;
    });
    try {
      final Map<ModuleKey, AdminMobileGrant> grants =
          await _repo.listMobileGrants(user.id);
      if (!mounted || _selected?.id != user.id) return;
      setState(() {
        _grants = grants;
        _grantsLoading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _grantsError = error;
        _grantsLoading = false;
      });
    }
  }

  Future<void> _change(ModuleKey module, AdminAccessChoice choice) async {
    final AdminUser? user = _selected;
    if (user == null || _busy != null) return;
    final AdminMobileGrant? existing = _grants[module];
    if (adminChoiceFor(existing) == choice) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _busy = module);
    try {
      if (existing != null) await _repo.clearMobileGrant(existing.id);
      if (choice != AdminAccessChoice.roleDefault) {
        await _repo.setMobileGrant(
          userId: user.id,
          module: module,
          effect: choice == AdminAccessChoice.allow
              ? AdminGrantEffect.grant
              : AdminGrantEffect.revoke,
        );
      }
      if (!mounted) return;
      adminShowSnack(context, l10n.adminAccessSaved);
    } on Object catch (error) {
      if (!mounted) return;
      adminShowSnack(
        context,
        adminErrorOf(error, l10n.adminAccessSaveFailed).message,
      );
    } finally {
      if (mounted) setState(() => _busy = null);
    }
    // Always re-read: the stored rows, not the optimistic choice, are truth.
    await _loadGrants();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AdminUser? selected = _selected;
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.adminAccessTitle,
        subtitle: selected == null
            ? l10n.adminAccessPickUser
            : (selected.displayName ?? l10n.adminUsersNoName),
        backFallback: fallback,
      ),
      body: selected == null ? _userPicker(l10n) : _editor(l10n, selected),
    );
  }

  Widget _userPicker(AppLocalizations l10n) {
    if (_usersLoading) return const TpLoadingState();
    if (_usersError != null) {
      return TpErrorState(
        error: adminErrorOf(_usersError!, l10n.adminUsersLoadFailed),
        onRetry: _loadUsers,
      );
    }
    final List<AdminUser> shown = _users
        .where((AdminUser user) => user.matches(_search.text))
        .toList(growable: false);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        TpSpace.xxxl,
      ),
      children: <Widget>[
        AdminNote(l10n.adminAccessIntro),
        const SizedBox(height: TpSpace.md),
        TpSearchField(
          key: const Key('admin.access.search'),
          controller: _search,
          hint: l10n.adminUsersSearchHint,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.md),
        if (shown.isEmpty)
          TpEmptyState(
            icon: Icons.person_search_outlined,
            title: l10n.adminUsersEmptyTitle,
            message: l10n.adminUsersEmptyMessage,
          )
        else
          for (final AdminUser user in shown) ...<Widget>[
            AdminNavTile(
              key: Key('admin.access.user.${user.id}'),
              icon: Icons.person_outline,
              title: user.displayName ?? l10n.adminUsersNoName,
              subtitle: user.role ?? l10n.adminUsersNoRole,
              onTap: () => unawaited(_select(user)),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
      ],
    );
  }

  Widget _editor(AppLocalizations l10n, AdminUser user) {
    final bool canWrite = ref.watch(accessStateProvider).isSuperAdmin;
    final UserRole role = UserRole.fromDatabase(user.role);
    final bool alwaysFull = user.isSuperAdmin || role.isAdministrator;
    final List<Widget> header = <Widget>[
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: TpButton.text(
          key: const Key('admin.access.changeUser'),
          label: l10n.adminAccessChangeUser,
          icon: Icons.swap_horiz_rounded,
          onPressed: () => setState(() {
            _selected = null;
            _grantsError = null;
          }),
        ),
      ),
      if (alwaysFull) ...<Widget>[
        AdminNote(l10n.adminAccessAdminNote),
        const SizedBox(height: TpSpace.sm),
      ],
      if (!canWrite) ...<Widget>[
        AdminNote(l10n.adminAccessReadOnlyNote),
        const SizedBox(height: TpSpace.sm),
      ],
    ];
    if (_grantsLoading && _grants.isEmpty) {
      return Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
            child: Column(children: header),
          ),
          const Expanded(child: TpLoadingState()),
        ],
      );
    }
    if (_grantsError != null) {
      return Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
            child: Column(children: header),
          ),
          Expanded(
            child: TpErrorState(
              error: adminErrorOf(_grantsError!, l10n.adminAccessLoadFailed),
              onRetry: _loadGrants,
            ),
          ),
        ],
      );
    }
    return RefreshIndicator(
      onRefresh: _loadGrants,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.sm,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          ...header,
          for (final ModuleGroup group in ModuleGroup.values) ...<Widget>[
            AdminSectionHeader(adminGroupLabel(l10n, group)),
            for (final ModuleDef def in ModuleRegistry.inGroup(group))
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.sm),
                child: _ModuleRow(
                  def: def,
                  role: role,
                  choice: adminChoiceFor(_grants[def.key]),
                  busy: _busy == def.key,
                  onChanged: canWrite && _busy == null
                      ? (AdminAccessChoice choice) =>
                          unawaited(_change(def.key, choice))
                      : null,
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _ModuleRow extends StatelessWidget {
  const _ModuleRow({
    required this.def,
    required this.role,
    required this.choice,
    required this.busy,
    required this.onChanged,
  });

  final ModuleDef def;
  final UserRole role;
  final AdminAccessChoice choice;
  final bool busy;
  final ValueChanged<AdminAccessChoice>? onChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String roleDefault = def.isAdminOnly
        ? l10n.adminAccessRoleDefaultAdminOnly
        : def.allowsByRoleDefault(role)
            ? l10n.adminAccessRoleDefaultAllowed
            : l10n.adminAccessRoleDefaultDenied;
    return TpCard(
      key: Key('admin.access.module.${def.key.wireKey}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      adminModuleLabel(l10n, def.key),
                      style: text.titleSmall,
                    ),
                    Text(
                      roleDefault,
                      style: text.bodySmall?.copyWith(
                        color: TpPalette.of(context).textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (busy)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          TpSegmented<AdminAccessChoice>(
            expanded: true,
            value: choice,
            onChanged: onChanged,
            options: <TpSegmentedOption<AdminAccessChoice>>[
              TpSegmentedOption<AdminAccessChoice>(
                value: AdminAccessChoice.roleDefault,
                label: l10n.adminAccessDefault,
              ),
              TpSegmentedOption<AdminAccessChoice>(
                value: AdminAccessChoice.allow,
                label: l10n.adminAccessAllow,
              ),
              TpSegmentedOption<AdminAccessChoice>(
                value: AdminAccessChoice.deny,
                label: l10n.adminAccessDeny,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
