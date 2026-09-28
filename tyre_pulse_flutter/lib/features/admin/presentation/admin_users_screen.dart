/// `/admin/users` - list, search and manage profiles.
///
/// Ported from `mobile/app/(app)/admin/users.tsx`. Every write goes through
/// `admin_mobile_user_action(uuid,text,text,text)`, which (live definition,
/// checked 2026-09-28) admits ONLY an active super admin, refuses a self
/// lock/deactivate/role change, guards the last admin and the last super
/// admin, and requires a reason for `deactivate` and `set_role`. The screen
/// mirrors those rules so the buttons it offers are the ones that can work,
/// and it still shows the server's refusal honestly when one arrives.
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
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_ui.dart';

class AdminUsersScreen extends ConsumerStatefulWidget {
  const AdminUsersScreen({required this.route, super.key});

  final AdminUsersRoute route;

  @override
  ConsumerState<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends ConsumerState<AdminUsersScreen> {
  final TextEditingController _search = TextEditingController();
  List<AdminUser> _users = const <AdminUser>[];
  Object? _error;
  bool _loading = true;
  AdminUserStatus? _status;
  String? _role;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<AdminUser> rows =
          await ref.read(adminRepositoryProvider).listUsers();
      if (!mounted) return;
      setState(() {
        _users = rows;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.adminUsersTitle,
        subtitle: _loading ? null : l10n.adminUsersCount(_users.length),
        backFallback: fallback,
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(
        error: adminErrorOf(_error!, l10n.adminUsersLoadFailed),
        onRetry: _load,
      );
    }
    final bool canWrite = ref.watch(accessStateProvider).isSuperAdmin;
    final List<String> roles = (_users
            .map((AdminUser u) => u.role)
            .whereType<String>()
            .toSet()
            .toList()
          ..sort())
        .toList(growable: false);
    final List<AdminUser> shown = _users.where((AdminUser user) {
      if (_status != null && user.status != _status) return false;
      if (_role != null && user.role != _role) return false;
      return user.matches(_search.text);
    }).toList(growable: false);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          if (!canWrite) ...<Widget>[
            AdminNote(l10n.adminUsersReadOnlyNote),
            const SizedBox(height: TpSpace.md),
          ],
          TpSearchField(
            key: const Key('admin.users.search'),
            controller: _search,
            hint: l10n.adminUsersSearchHint,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.md),
          TpSegmented<AdminUserStatus?>(
            key: const Key('admin.users.status'),
            expanded: true,
            value: _status,
            onChanged: (AdminUserStatus? value) =>
                setState(() => _status = value),
            options: <TpSegmentedOption<AdminUserStatus?>>[
              TpSegmentedOption<AdminUserStatus?>(
                value: null,
                label: l10n.adminUsersFilterAll,
              ),
              for (final AdminUserStatus status in AdminUserStatus.values)
                TpSegmentedOption<AdminUserStatus?>(
                  value: status,
                  label: adminStatusLabel(l10n, status),
                ),
            ],
          ),
          if (roles.length > 1) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: <Widget>[
                  _roleChip(l10n.adminUsersAllRoles, null),
                  for (final String role in roles) _roleChip(role, role),
                ],
              ),
            ),
          ],
          const SizedBox(height: TpSpace.md),
          if (shown.isEmpty)
            TpEmptyState(
              icon: Icons.person_search_outlined,
              title: l10n.adminUsersEmptyTitle,
              message: l10n.adminUsersEmptyMessage,
            )
          else
            for (final AdminUser user in shown) ...<Widget>[
              _UserCard(
                user: user,
                onTap: () => unawaited(_openDetail(user, canWrite)),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }

  Widget _roleChip(String label, String? value) => Padding(
        padding: const EdgeInsetsDirectional.only(end: TpSpace.sm),
        child: ChoiceChip(
          label: Text(label),
          selected: _role == value,
          onSelected: (_) => setState(() => _role = value),
        ),
      );

  Future<void> _openDetail(AdminUser user, bool canWrite) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isSelf =
        user.id == ref.read(adminRepositoryProvider).currentUserId;
    final AdminUserAction? action = await TpBottomSheet.show<AdminUserAction>(
      context: context,
      title: user.displayName ?? l10n.adminUsersNoName,
      builder: (BuildContext sheetContext) => _UserDetail(
        user: user,
        canWrite: canWrite,
        isSelf: isSelf,
        onAction: (AdminUserAction picked) =>
            Navigator.of(sheetContext).pop(picked),
      ),
    );
    if (action == null || !mounted) return;
    await _run(user, action);
  }

  Future<void> _run(AdminUser user, AdminUserAction action) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String name = user.displayName ?? l10n.adminUsersNoName;
    String? reason;
    String? role;
    switch (action) {
      case AdminUserAction.approve:
      case AdminUserAction.lock:
      case AdminUserAction.unlock:
        final bool ok = await TpDialog.confirm(
          context: context,
          title: switch (action) {
            AdminUserAction.approve => l10n.adminUsersConfirmApproveTitle,
            AdminUserAction.lock => l10n.adminUsersConfirmLockTitle,
            _ => l10n.adminUsersConfirmUnlockTitle,
          },
          message: switch (action) {
            AdminUserAction.approve => l10n.adminUsersConfirmApproveMessage(
                name,
              ),
            AdminUserAction.lock => l10n.adminUsersConfirmLockMessage(name),
            _ => l10n.adminUsersConfirmUnlockMessage(name),
          },
          confirmLabel: _actionLabel(l10n, action),
          isDestructive: action == AdminUserAction.lock,
        );
        if (!ok) return;
      case AdminUserAction.deactivate:
      case AdminUserAction.setRole:
        if (!mounted) return;
        final (String, String?)? answer = await showDialog<(String, String?)>(
          context: context,
          builder: (BuildContext dialogContext) => _ReasonDialog(
            title: action == AdminUserAction.setRole
                ? l10n.adminUsersSetRoleTitle
                : l10n.adminUsersDeactivateTitle,
            message: action == AdminUserAction.setRole
                ? l10n.adminUsersSetRoleMessage(name)
                : l10n.adminUsersDeactivateMessage(name),
            confirmLabel: _actionLabel(l10n, action),
            destructive: action == AdminUserAction.deactivate,
            initialRole: action == AdminUserAction.setRole ? user.role : null,
            askRole: action == AdminUserAction.setRole,
          ),
        );
        if (answer == null) return;
        reason = answer.$1;
        role = answer.$2;
    }
    if (!mounted) return;
    try {
      await ref.read(adminRepositoryProvider).runUserAction(
            userId: user.id,
            action: action,
            reason: reason,
            role: role,
          );
      if (!mounted) return;
      adminShowSnack(context, l10n.adminUsersActionDone);
      await _load();
    } on Object catch (error) {
      if (!mounted) return;
      adminShowSnack(
        context,
        adminErrorOf(error, l10n.adminUsersActionFailed).message,
      );
    }
  }
}

String _actionLabel(AppLocalizations l10n, AdminUserAction action) =>
    switch (action) {
      AdminUserAction.approve => l10n.adminUsersActionApprove,
      AdminUserAction.lock => l10n.adminUsersActionLock,
      AdminUserAction.unlock => l10n.adminUsersActionUnlock,
      AdminUserAction.deactivate => l10n.adminUsersActionDeactivate,
      AdminUserAction.setRole => l10n.adminUsersActionSetRole,
    };

class _UserCard extends StatelessWidget {
  const _UserCard({required this.user, required this.onTap});

  final AdminUser user;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String name = user.displayName ?? l10n.adminUsersNoName;
    final String secondary = <String?>[
      user.role ?? l10n.adminUsersNoRole,
      user.site,
    ].whereType<String>().join(' · ');
    return TpCard(
      key: Key('admin.users.row.${user.id}'),
      onTap: onTap,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          CircleAvatar(
            radius: 20,
            backgroundColor: palette.primarySoft,
            child: Text(
              name.characters.first.toUpperCase(),
              style: text.titleSmall?.copyWith(color: palette.primaryDark),
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(name, style: text.titleSmall),
                const SizedBox(height: 2),
                Text(
                  secondary,
                  style: text.bodySmall?.copyWith(
                    color: palette.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (user.isSuperAdmin) ...<Widget>[
            const Icon(Icons.verified_user_outlined, size: 18),
            const SizedBox(width: TpSpace.xs),
          ],
          TpStatusChip(
            status: adminStatusTone(user.status),
            label: adminStatusLabel(l10n, user.status),
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _UserDetail extends StatelessWidget {
  const _UserDetail({
    required this.user,
    required this.canWrite,
    required this.isSelf,
    required this.onAction,
  });

  final AdminUser user;
  final bool canWrite;
  final bool isSelf;
  final ValueChanged<AdminUserAction> onAction;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final MaterialLocalizations material = MaterialLocalizations.of(context);
    final List<(String, String?)> fields = <(String, String?)>[
      (l10n.adminUsersFieldRole, user.role ?? l10n.adminUsersNoRole),
      (l10n.adminUsersFieldUsername, user.username),
      (l10n.adminUsersFieldEmployeeId, user.employeeId),
      (l10n.adminUsersFieldEmail, user.email),
      (l10n.adminUsersFieldSite, user.site),
      (
        l10n.adminUsersFieldCountry,
        user.countries.isEmpty ? null : user.countries.join(', '),
      ),
      (
        l10n.adminUsersFieldJoined,
        user.createdAt == null
            ? null
            : material.formatMediumDate(user.createdAt!.toLocal()),
      ),
      (l10n.adminUsersFieldPendingReason, user.pendingReason),
    ];
    final List<AdminUserAction> actions = <AdminUserAction>[
      if (user.status == AdminUserStatus.pending) AdminUserAction.approve,
      if (user.locked == true) AdminUserAction.unlock,
      if (user.locked != true && !isSelf) AdminUserAction.lock,
      if (!isSelf) AdminUserAction.setRole,
      if (!isSelf && user.status != AdminUserStatus.locked)
        AdminUserAction.deactivate,
    ];
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Wrap(
            spacing: TpSpace.sm,
            children: <Widget>[
              TpStatusChip(
                status: adminStatusTone(user.status),
                label: adminStatusLabel(l10n, user.status),
              ),
              if (user.isSuperAdmin)
                TpStatusChip(
                  status: TpStatus.info,
                  label: l10n.adminUsersSuperAdminBadge,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          for (final (String, String?) field in fields)
            if (field.$2 != null)
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    SizedBox(
                      width: 120,
                      child: Text(
                        field.$1,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: TpPalette.of(context).textSecondary,
                            ),
                      ),
                    ),
                    Expanded(child: Text(field.$2!)),
                  ],
                ),
              ),
          const SizedBox(height: TpSpace.md),
          if (!canWrite)
            AdminNote(l10n.adminUsersReadOnlyNote)
          else ...<Widget>[
            if (isSelf) ...<Widget>[
              AdminNote(l10n.adminUsersSelfNote),
              const SizedBox(height: TpSpace.sm),
            ],
            for (final AdminUserAction action in actions) ...<Widget>[
              TpButton(
                key: Key('admin.users.action.${action.wire}'),
                label: _actionLabel(l10n, action),
                variant: switch (action) {
                  AdminUserAction.approve => TpButtonVariant.primary,
                  AdminUserAction.lock ||
                  AdminUserAction.deactivate =>
                    TpButtonVariant.danger,
                  _ => TpButtonVariant.secondary,
                },
                isFullWidth: true,
                onPressed: () => onAction(action),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
          ],
        ],
      ),
    );
  }
}

/// Collects the reason (and, for a role change, the new role) the RPC
/// requires. Resolves to `(reason, role)` or null when cancelled.
class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({
    required this.title,
    required this.message,
    required this.confirmLabel,
    required this.destructive,
    required this.askRole,
    this.initialRole,
  });

  final String title;
  final String message;
  final String confirmLabel;
  final bool destructive;
  final bool askRole;
  final String? initialRole;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final TextEditingController _reason = TextEditingController();
  RoleId? _role;
  bool _showErrors = false;

  @override
  void initState() {
    super.initState();
    _role = roleIdFromRaw(widget.initialRole);
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final String reason = _reason.text.trim();
    if (reason.isEmpty || (widget.askRole && _role == null)) {
      setState(() => _showErrors = true);
      return;
    }
    Navigator.of(context).pop((reason, _role?.databaseName));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.message),
            const SizedBox(height: TpSpace.md),
            if (widget.askRole) ...<Widget>[
              DropdownButtonFormField<RoleId>(
                key: const Key('admin.users.roleField'),
                initialValue: _role,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: l10n.adminUsersFieldRole,
                  errorText: _showErrors && _role == null
                      ? l10n.adminUsersRoleRequired
                      : null,
                ),
                items: <DropdownMenuItem<RoleId>>[
                  for (final RoleId id in RoleId.values)
                    DropdownMenuItem<RoleId>(
                      value: id,
                      child: Text(id.databaseName),
                    ),
                ],
                onChanged: (RoleId? value) => setState(() => _role = value),
              ),
              const SizedBox(height: TpSpace.md),
            ],
            TextField(
              key: const Key('admin.users.reasonField'),
              controller: _reason,
              maxLines: 3,
              minLines: 1,
              decoration: InputDecoration(
                labelText: l10n.adminUsersReasonLabel,
                errorText: _showErrors && _reason.text.trim().isEmpty
                    ? l10n.adminUsersReasonRequired
                    : null,
              ),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TpButton.text(
          label: l10n.actionCancel,
          onPressed: () => Navigator.of(context).pop(),
        ),
        if (widget.destructive)
          TpButton.danger(
            key: const Key('admin.users.reasonConfirm'),
            label: widget.confirmLabel,
            onPressed: _submit,
          )
        else
          TpButton.primary(
            key: const Key('admin.users.reasonConfirm'),
            label: widget.confirmLabel,
            onPressed: _submit,
          ),
      ],
    );
  }
}
