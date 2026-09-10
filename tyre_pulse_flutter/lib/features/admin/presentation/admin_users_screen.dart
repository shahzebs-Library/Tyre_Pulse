import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/domain/admin_user.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_access_screen.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';

class AdminUsersScreen extends ConsumerStatefulWidget {
  const AdminUsersScreen({this.accessMode = false, super.key});
  final bool accessMode;
  @override
  ConsumerState<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends ConsumerState<AdminUsersScreen> {
  int _offset = 0;
  bool _acting = false;
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _act(AdminUser user, AdminUserAction action) async {
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;
    final copy = AdminCopy(context);
    final l10n = AppLocalizations.of(context);
    final reason = _reason..clear();
    final form = GlobalKey<FormState>();
    RoleId? role;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${copy.action(action)}: ${user.displayName}'),
        content: SingleChildScrollView(
          child: Form(
            key: form,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(copy.online),
                if (action == AdminUserAction.setRole)
                  DropdownButtonFormField<RoleId>(
                    decoration: InputDecoration(labelText: copy.builtIn),
                    isExpanded: true,
                    items: [
                      for (final candidate in RoleId.values)
                        if (candidate.isBuiltIn &&
                            (candidate != RoleId.admin ||
                                workspace.effectivePermissions.isSuperAdmin))
                          DropdownMenuItem(
                            value: candidate,
                            child: Text(candidate.databaseName),
                          ),
                    ],
                    onChanged: (value) => role = value,
                    validator: (value) => value == null ? copy.builtIn : null,
                  ),
                TextFormField(
                  controller: reason,
                  decoration: InputDecoration(labelText: copy.reason),
                  maxLength: 500,
                  validator: (value) =>
                      action.requiresReason && (value?.trim().isEmpty ?? true)
                          ? copy.required
                          : null,
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () {
              if (form.currentState!.validate()) Navigator.pop(context, true);
            },
            child: Text(copy.action(action)),
          ),
        ],
      ),
    );
    final enteredReason = reason.text;
    if (confirmed != true || !mounted) return;
    // Do not carry an approval across a workspace change while confirming.
    if (ref.read(workspaceContextProvider) != workspace) return;
    setState(() => _acting = true);
    try {
      await ref.read(adminUsersRepositoryProvider).act(
            workspace,
            user,
            action,
            reason: enteredReason,
            role: role,
          );
      if (!mounted) return;
      ref.invalidate(adminUsersPageProvider);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy.saved)));
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(mapSupabaseError(error).message)),
      );
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = AdminCopy(context);
    final l10n = AppLocalizations.of(context);
    final workspace = ref.watch(workspaceContextProvider);
    final allowed = widget.accessMode
        ? ref.watch(accessStateProvider).isSuperAdmin
        : ref.watch(adminUsersAllowedProvider);
    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(
        title: widget.accessMode ? copy.access : copy.users,
        backFallback: TpRoutePaths.home,
      ),
      body: !allowed
          ? TpPermissionDeniedState(reason: l10n.deniedAdminOnly)
          : workspace == null
              ? const TpLoadingState()
              : ref.watch(adminUsersPageProvider(_offset)).when(
                    loading: () => const TpLoadingState(),
                    error: (error, stack) => TpErrorState(
                      error: mapSupabaseError(error),
                      onRetry: () =>
                          ref.invalidate(adminUsersPageProvider(_offset)),
                    ),
                    data: (users) => RefreshIndicator(
                      onRefresh: () =>
                          ref.refresh(adminUsersPageProvider(_offset).future),
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        children: [
                          Text(copy.online),
                          if (_acting) const LinearProgressIndicator(),
                          if (users.isEmpty)
                            Padding(
                              padding: const EdgeInsets.all(24),
                              child: Text(copy.empty),
                            ),
                          for (final user in users)
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      user.displayName,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium,
                                    ),
                                    Text(
                                      '${user.username} · ${user.profile.role.displayName}',
                                    ),
                                    Text(
                                      user.profile.isLocked
                                          ? copy.locked
                                          : user.profile.isApproved
                                              ? copy.active
                                              : copy.pending,
                                    ),
                                    Wrap(
                                      spacing: 8,
                                      children: [
                                        if (widget.accessMode)
                                          TextButton(
                                            onPressed: () =>
                                                Navigator.of(context)
                                                    .push<void>(
                                              MaterialPageRoute(
                                                builder: (_) =>
                                                    AdminAccessScreen(
                                                  user: user,
                                                ),
                                              ),
                                            ),
                                            child: Text(copy.access),
                                          ),
                                        for (final action in widget.accessMode
                                            ? <AdminUserAction>{}
                                            : user.allowedActions(workspace))
                                          TextButton(
                                            onPressed: _acting
                                                ? null
                                                : () => _act(user, action),
                                            child: Text(copy.action(action)),
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          Wrap(
                            alignment: WrapAlignment.spaceBetween,
                            spacing: 16,
                            children: [
                              if (_offset > 0)
                                TextButton(
                                  onPressed: _acting
                                      ? null
                                      : () => setState(() => _offset -= 50),
                                  child: Text(copy.previous),
                                ),
                              if (users.length == 50)
                                TextButton(
                                  onPressed: _acting
                                      ? null
                                      : () => setState(() => _offset += 50),
                                  child: Text(copy.next),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
    );
  }
}
