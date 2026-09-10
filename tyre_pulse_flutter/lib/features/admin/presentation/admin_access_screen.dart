import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/admin/admin_providers.dart';
import 'package:tyre_pulse/features/admin/data/admin_access_repository.dart';
import 'package:tyre_pulse/features/admin/domain/admin_user.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_copy.dart';

class AdminAccessScreen extends ConsumerStatefulWidget {
  const AdminAccessScreen({required this.user, super.key});
  final AdminUser user;
  @override
  ConsumerState<AdminAccessScreen> createState() => _AdminAccessScreenState();
}

class _AdminAccessScreenState extends ConsumerState<AdminAccessScreen> {
  bool _saving = false;

  Future<void> _change(ModuleKey module, MobileAccessOverride value) async {
    final copy = AdminCopy(context);
    final l10n = AppLocalizations.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${copy.module(module)}: ${copy.overrideLabel(value)}'),
        content: Text('${widget.user.displayName}\n${copy.accessNote}'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(copy.pick('Apply', 'تطبيق', 'لاگو کریں')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _saving = true);
    try {
      await ref.read(adminAccessRepositoryProvider).change(
            widget.user.id,
            module,
            value,
            superAdmin: ref.read(accessStateProvider).isSuperAdmin,
          );
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(copy.saved)));
      }
    } on Object catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content:
                Text('${copy.partial}\n${mapSupabaseError(error).message}'),
          ),
        );
      }
    } finally {
      if (mounted) {
        ref.invalidate(adminAccessGrantsProvider(widget.user.id));
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = AdminCopy(context);
    final l10n = AppLocalizations.of(context);
    final superAdmin = ref.watch(accessStateProvider).isSuperAdmin;
    return TpScaffold(
      appBar: TpAppBar(
        title: copy.access,
        subtitle: widget.user.displayName,
        onBack: () => Navigator.of(context).maybePop(),
      ),
      body: !superAdmin
          ? TpPermissionDeniedState(reason: l10n.deniedAdminOnly)
          : ref.watch(adminAccessGrantsProvider(widget.user.id)).when(
                loading: () => const TpLoadingState(),
                error: (error, stack) => TpErrorState(
                  error: mapSupabaseError(error),
                  onRetry: () =>
                      ref.invalidate(adminAccessGrantsProvider(widget.user.id)),
                ),
                data: (grants) => ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(copy.accessNote),
                    if (_saving) const LinearProgressIndicator(),
                    for (final module in ModuleKey.values)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                copy.module(module),
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              DropdownButton<MobileAccessOverride>(
                                isExpanded: true,
                                value: effectiveMobileOverride(
                                  grants,
                                  module,
                                  DateTime.now(),
                                ),
                                items: [
                                  for (final value
                                      in MobileAccessOverride.values)
                                    DropdownMenuItem(
                                      value: value,
                                      child: Text(copy.overrideLabel(value)),
                                    ),
                                ],
                                onChanged: _saving
                                    ? null
                                    : (value) {
                                        if (value != null) {
                                          _change(module, value);
                                        }
                                      },
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
    );
  }
}
