/// The vehicle handover history and signer queue.
///
/// Two scopes: "My handovers" (what this user captured) and "To sign"
/// (handovers awaiting a sign-off, for a supervisor/incharge). Each row opens
/// the detail screen, where the sign-off happens. A new handover is started
/// from the header. On open it flushes the submission queue so anything
/// captured offline earlier is delivered.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart'
    show TpIdentifierText;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';
import 'package:tyre_pulse/features/handover/handover_providers.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_copy.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_ui.dart';

enum _HandoverScope { mine, toSign }

class HandoverHistoryScreen extends ConsumerStatefulWidget {
  const HandoverHistoryScreen({super.key});

  @override
  ConsumerState<HandoverHistoryScreen> createState() =>
      _HandoverHistoryScreenState();
}

class _HandoverHistoryScreenState extends ConsumerState<HandoverHistoryScreen> {
  _HandoverScope _scope = _HandoverScope.mine;

  @override
  void initState() {
    super.initState();
    unawaited(_flush());
  }

  Future<void> _flush() async {
    try {
      await ref.read(handoverSyncEngineProvider).flushQueue();
    } on Object {
      // Best effort - a flush failure is the ordinary offline case.
    }
    if (!mounted) return;
    ref
      ..invalidate(handoverPendingCountProvider)
      ..invalidate(myHandoversProvider)
      ..invalidate(pendingHandoversProvider);
  }

  Future<void> _refresh() async {
    await _flush();
    ref
      ..invalidate(myHandoversProvider)
      ..invalidate(pendingHandoversProvider);
    await ref.read(
      _scope == _HandoverScope.mine
          ? myHandoversProvider.future
          : pendingHandoversProvider.future,
    );
  }

  void _openNew() {
    unawaited(context.push(const NewHandoverRoute().location));
  }

  void _open(HandoverRecord record) {
    unawaited(
      context.push(
        HandoverDetailRoute(handoverId: HandoverId(record.id)).location,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<int> pending = ref.watch(handoverPendingCountProvider);
    final AsyncValue<List<HandoverRecord>> records = ref.watch(
      _scope == _HandoverScope.mine
          ? myHandoversProvider
          : pendingHandoversProvider,
    );

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.handoverNavTitle,
        actions: <Widget>[
          IconButton(
            tooltip: l10n.handoverNewAction,
            onPressed: _openNew,
            icon: const Icon(Icons.add),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openNew,
        icon: const Icon(Icons.add),
        label: Text(l10n.handoverNewAction),
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                TpSpace.lg,
                TpSpace.md,
                TpSpace.lg,
                TpSpace.sm,
              ),
              child: TpSegmented<_HandoverScope>(
                expanded: true,
                value: _scope,
                options: <TpSegmentedOption<_HandoverScope>>[
                  TpSegmentedOption<_HandoverScope>(
                    value: _HandoverScope.mine,
                    label: l10n.handoverTabMine,
                  ),
                  TpSegmentedOption<_HandoverScope>(
                    value: _HandoverScope.toSign,
                    label: l10n.handoverTabToSign,
                  ),
                ],
                onChanged: (_HandoverScope s) => setState(() => _scope = s),
              ),
            ),
            if ((pending.value ?? 0) > 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  TpSpace.lg,
                  0,
                  TpSpace.lg,
                  TpSpace.sm,
                ),
                child: _PendingSyncBanner(count: pending.value!),
              ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _refresh,
                child: records.when(
                  loading: () => const TpLoadingState(),
                  error: (Object error, StackTrace stack) => TpErrorState(
                    error:
                        handoverAsAppError(error, l10n.handoverListLoadFailed),
                    onRetry: _refresh,
                  ),
                  data: (List<HandoverRecord> list) {
                    if (list.isEmpty) {
                      return ListView(
                        children: <Widget>[
                          const SizedBox(height: TpSpace.huge),
                          TpEmptyState(
                            icon: Icons.swap_horiz,
                            title: _scope == _HandoverScope.mine
                                ? l10n.handoverEmptyMineTitle
                                : l10n.handoverEmptyToSignTitle,
                            message: _scope == _HandoverScope.mine
                                ? l10n.handoverEmptyMineMessage
                                : l10n.handoverEmptyToSignMessage,
                            actionLabel: _scope == _HandoverScope.mine
                                ? l10n.handoverNewAction
                                : null,
                            onAction:
                                _scope == _HandoverScope.mine ? _openNew : null,
                          ),
                        ],
                      );
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.fromLTRB(
                        TpSpace.lg,
                        TpSpace.sm,
                        TpSpace.lg,
                        TpSpace.huge,
                      ),
                      itemCount: list.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: TpSpace.sm),
                      itemBuilder: (BuildContext context, int index) =>
                          _HandoverCard(
                        record: list[index],
                        onTap: () => _open(list[index]),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PendingSyncBanner extends StatelessWidget {
  const _PendingSyncBanner({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.warning);
    return TpCard(
      background: colors.soft,
      borderColor: colors.base,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Icon(Icons.cloud_upload_outlined, color: colors.onSoft),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              l10n.handoverPendingSync,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSoft),
            ),
          ),
          TpStatusChip(
            status: TpStatus.warning,
            label: '$count',
            isCompact: true,
          ),
        ],
      ),
    );
  }
}

class _HandoverCard extends StatelessWidget {
  const _HandoverCard({required this.record, required this.onTap});

  final HandoverRecord record;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String? when =
        formatHandoverDateTime(record.handoverAt ?? record.createdAt);
    final String typeLabel = record.handoverType == null
        ? l10n.handoverNavTitle
        : handoverTypeLabel(l10n, record.handoverType!);

    return TpCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: TpIdentifierText(
                  record.assetNo,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              TpStatusChip(
                status: handoverStatusTone(record.approvalStatus),
                label: handoverStatusText(l10n, record.approvalStatus),
                isCompact: true,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              TpStatusChip(
                status: TpStatus.info,
                icon: record.handoverType == HandoverType.checkin
                    ? Icons.login
                    : Icons.logout,
                label: typeLabel,
                isCompact: true,
              ),
              if (record.documentNo != null)
                Text(
                  record.documentNo!,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              if (when != null)
                Text(
                  when,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              if (record.effectiveDamageCount > 0)
                TpStatusChip(
                  status: TpStatus.warning,
                  icon: Icons.report_problem_outlined,
                  label: '${record.effectiveDamageCount}',
                  isCompact: true,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
