/// "My counts": the physical audits assigned to the signed-in counter.
///
/// Pushed with [Navigator] from Stock Count, because routes live in reserved
/// files (`docs/inventory_reserved_patch.md` adds the proper route). It shows
/// the counter's unsynced on-device work FIRST and even when the audit list
/// cannot be loaded, so a counter with no signal still sees that their counts
/// are safe on the phone.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/blind_count_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

/// Unsynced sessions of the signed-in user, from the encrypted draft store.
final FutureProvider<Map<String, CountSession>> myCountDraftsProvider =
    FutureProvider<Map<String, CountSession>>((Ref ref) async {
  final String? userId = ref.watch(workspaceContextProvider)?.userId;
  if (userId == null) return const <String, CountSession>{};
  return ref.watch(countDraftStoreProvider).loadAll(userId);
});

class MyAuditsScreen extends ConsumerWidget {
  const MyAuditsScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const MyAuditsScreen(),
        settings: const RouteSettings(name: 'inventory/my-audits'),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final AsyncValue<List<InventoryAuditSummary>> audits =
        ref.watch(myInventoryAuditsProvider);
    final AsyncValue<Map<String, CountSession>> drafts =
        ref.watch(myCountDraftsProvider);
    final Map<String, CountSession> local = switch (drafts) {
      AsyncData<Map<String, CountSession>>(:final value) => value,
      _ => const <String, CountSession>{},
    };

    Future<void> refresh() async {
      ref
        ..invalidate(myInventoryAuditsProvider)
        ..invalidate(myCountDraftsProvider);
      await ref.read(myInventoryAuditsProvider.future).then(
            (_) {},
            onError: (Object _) {},
          );
    }

    void open(String auditId) {
      unawaited(
        Navigator.of(context)
            .push(BlindCountScreen.route(auditId))
            .then((_) => ref.invalidate(myCountDraftsProvider)),
      );
    }

    return TpScaffold(
      appBar: TpAppBar(title: copy('myAuditsTitle')),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.xxxl,
          ),
          children: <Widget>[
            if (drafts is AsyncError<Map<String, CountSession>>)
              _Banner(text: copy('draftsUnreadable')),
            for (final CountSession s in local.values)
              if (s.pending.isNotEmpty)
                _Banner(
                  key: Key('inventory.audits.unsynced.${s.auditId}'),
                  text: copy.count('unsyncedLines', s.pending.length),
                  onTap: () => open(s.auditId),
                ),
            ...switch (audits) {
              AsyncLoading<List<InventoryAuditSummary>>() => <Widget>[
                  const SizedBox(height: 240, child: TpLoadingState()),
                ],
              AsyncError<List<InventoryAuditSummary>>(:final error) => <Widget>[
                  SizedBox(
                    height: 360,
                    child: InventoryFailureView(
                      error: error,
                      copy: copy,
                      onRetry: () => unawaited(refresh()),
                    ),
                  ),
                ],
              AsyncData<List<InventoryAuditSummary>>(:final value)
                  when value.isEmpty =>
                <Widget>[
                  SizedBox(
                    height: 320,
                    child: TpEmptyState(
                      icon: Icons.fact_check_outlined,
                      title: copy('noAudits'),
                      message: copy('noAuditsBody'),
                    ),
                  ),
                ],
              AsyncData<List<InventoryAuditSummary>>(:final value) => <Widget>[
                  for (final InventoryAuditSummary a in value) ...<Widget>[
                    _AuditCard(
                      audit: a,
                      copy: copy,
                      pending: local[a.id]?.pending.length ?? 0,
                      onOpen: () => open(a.id),
                    ),
                    const SizedBox(height: TpSpace.sm),
                  ],
                ],
            },
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, this.onTap, super.key});

  final String text;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Material(
        color: Theme.of(context).colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: inventoryTouchTarget),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Row(
                children: <Widget>[
                  const Icon(Icons.cloud_upload_outlined),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(child: Text(text)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AuditCard extends StatelessWidget {
  const _AuditCard({
    required this.audit,
    required this.copy,
    required this.pending,
    required this.onOpen,
  });

  final InventoryAuditSummary audit;
  final InventoryCopy copy;
  final int pending;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool overdue = audit.isOverdue(DateTime.now());
    return Card(
      key: Key('inventory.audit.${audit.id}'),
      child: InkWell(
        onTap: audit.acceptsCounts || pending > 0 ? onOpen : null,
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                audit.reference ?? copy('audit'),
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: TpSpace.xs),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.xs,
                children: <Widget>[
                  if (audit.auditType != null)
                    Chip(label: Text(copy.label('type_', audit.auditType!))),
                  Chip(
                    label: Text(
                      copy.label('status_', audit.status ?? 'unknown'),
                    ),
                  ),
                  if (audit.site != null) Chip(label: Text(audit.site!)),
                  if (overdue)
                    Chip(
                      label: Text(copy('overdue')),
                      backgroundColor: theme.colorScheme.errorContainer,
                    ),
                  if (pending > 0)
                    Chip(label: Text(copy.count('pendingN', pending))),
                ],
              ),
              if (audit.dueAt != null) ...<Widget>[
                const SizedBox(height: TpSpace.xs),
                Text(
                  '${copy('due')}: '
                  '${MaterialLocalizations.of(context).formatMediumDate(audit.dueAt!.toLocal())}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
              if (audit.instructions != null) ...<Widget>[
                const SizedBox(height: TpSpace.xs),
                Text(audit.instructions!, style: theme.textTheme.bodySmall),
              ],
              if (!audit.acceptsCounts) ...<Widget>[
                const SizedBox(height: TpSpace.xs),
                Text(copy('notCounting'), style: theme.textTheme.bodySmall),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
