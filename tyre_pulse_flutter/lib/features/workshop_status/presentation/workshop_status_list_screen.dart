/// Daily Ops -> Workshop Status: the vehicles currently in the workshop's
/// daily report, for the field team who keep each one up to date.
///
/// The owner's ask: "they get a notification when we upload and they update
/// it". A notification about the workshop report lands here, and a tap on a
/// vehicle opens the update screen.
///
/// - Server permission first: `workshop_status_my_permissions().view` decides
///   whether this screen shows anything. A read failure fails CLOSED.
/// - Mine / All: Mine is the vehicles whose responsible person is me.
/// - Days down is shown only when measurable; never an invented 0.
/// - "Not updated today" is judged on the last PERSON update, not on an
///   Excel refresh.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/workshop_status/data/workshop_status_repository.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_record.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_copy.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_detail_screen.dart';
import 'package:tyre_pulse/features/workshop_status/workshop_status_providers.dart';

/// Stable finders.
abstract final class WorkshopStatusKeys {
  static const Key search = ValueKey<String>('workshopStatus.search');
  static const Key scope = ValueKey<String>('workshopStatus.scope');
  static const Key list = ValueKey<String>('workshopStatus.list');
  static const Key truncated = ValueKey<String>('workshopStatus.truncated');
  static Key row(String id) => ValueKey<String>('workshopStatus.row.$id');
  static Key staleBadge(String id) =>
      ValueKey<String>('workshopStatus.stale.$id');
}

enum WorkshopStatusScope { mine, all }

/// Applies the Mine / All scope and the search box. Pure, for tests.
List<WorkshopStatusRecord> filterWorkshopRecords(
  List<WorkshopStatusRecord> records, {
  required WorkshopStatusScope scope,
  required String query,
  required String userId,
  required DateTime now,
}) {
  final List<WorkshopStatusRecord> out = records
      .where(
        (WorkshopStatusRecord r) =>
            (scope == WorkshopStatusScope.all || r.isResponsible(userId)) &&
            r.matches(query),
      )
      .toList();
  // Longest down first; unmeasurable last; asset code as a stable tiebreak.
  out.sort((WorkshopStatusRecord a, WorkshopStatusRecord b) {
    final int? da = a.daysDown(now);
    final int? db = b.daysDown(now);
    if (da != db) {
      if (da == null) return 1;
      if (db == null) return -1;
      return db.compareTo(da);
    }
    return (a.assetNo ?? '').compareTo(b.assetNo ?? '');
  });
  return out;
}

class WorkshopStatusListScreen extends ConsumerStatefulWidget {
  const WorkshopStatusListScreen({required this.route, super.key});

  final WorkshopStatusRoute route;

  @override
  ConsumerState<WorkshopStatusListScreen> createState() =>
      _WorkshopStatusListScreenState();
}

class _WorkshopStatusListScreenState
    extends ConsumerState<WorkshopStatusListScreen> {
  final TextEditingController _search = TextEditingController();
  String _query = '';
  WorkshopStatusScope _scope = WorkshopStatusScope.mine;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    ref
      ..invalidate(workshopStatusPermissionsProvider)
      ..invalidate(workshopStatusActiveProvider);
    try {
      await ref.read(workshopStatusActiveProvider.future);
    } on Object {
      // Rendered by the error state below.
    }
  }

  Future<void> _open(WorkshopStatusRecord record) async {
    final bool? saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (BuildContext _) => WorkshopStatusDetailScreen(record: record),
      ),
    );
    if (saved == true && mounted) {
      ref.invalidate(workshopStatusActiveProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopStatusCopy copy = WorkshopStatusCopy.of(context);
    final AsyncValue<WorkshopStatusPermissions> permissions =
        ref.watch(workshopStatusPermissionsProvider);

    return TpScaffold(
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: copy('subtitle'),
        backFallback: TpRoutePaths.home,
      ),
      backFallback: TpRoutePaths.home,
      body: permissions.when(
        loading: () => const TpLoadingState(),
        error: (Object _, StackTrace __) =>
            TpPermissionDeniedState(reason: copy('noAccess')),
        data: (WorkshopStatusPermissions p) => p.view
            ? _buildList(context, copy)
            : TpPermissionDeniedState(reason: copy('noAccess')),
      ),
    );
  }

  Widget _buildList(BuildContext context, WorkshopStatusCopy copy) {
    final AsyncValue<WorkshopStatusList> data =
        ref.watch(workshopStatusActiveProvider);
    final String userId = ref.watch(workshopStatusUserIdProvider);
    final DateTime now = ref.watch(workshopStatusClockProvider)();

    return data.when(
      loading: () => TpLoadingState(message: copy('loading')),
      error: (Object error, StackTrace _) => TpErrorState(
        error: _asAppError(error, copy('loadFailed')),
        onRetry: () => unawaited(_refresh()),
      ),
      data: (WorkshopStatusList list) {
        final List<WorkshopStatusRecord> visible = filterWorkshopRecords(
          list.records,
          scope: _scope,
          query: _query,
          userId: userId,
          now: now,
        );
        final int notToday = visible
            .where(
              (WorkshopStatusRecord r) =>
                  r.freshness(now) != WorkshopFreshness.today,
            )
            .length;
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            key: WorkshopStatusKeys.list,
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(TpSpace.lg),
            children: <Widget>[
              TpSearchField(
                key: WorkshopStatusKeys.search,
                controller: _search,
                hint: copy('searchHint'),
                onChanged: (String v) => setState(() => _query = v),
              ),
              const SizedBox(height: TpSpace.md),
              TpSegmented<WorkshopStatusScope>(
                key: WorkshopStatusKeys.scope,
                expanded: true,
                value: _scope,
                onChanged: (WorkshopStatusScope v) =>
                    setState(() => _scope = v),
                options: <TpSegmentedOption<WorkshopStatusScope>>[
                  TpSegmentedOption<WorkshopStatusScope>(
                    value: WorkshopStatusScope.mine,
                    label: copy('mine'),
                    icon: Icons.person_outline,
                  ),
                  TpSegmentedOption<WorkshopStatusScope>(
                    value: WorkshopStatusScope.all,
                    label: copy('all'),
                    icon: Icons.list_alt_outlined,
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.md),
              Text(
                '${copy('vehicles')}: ${visible.length}'
                ' · ${copy('notUpdatedToday')}: $notToday',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: TpPalette.of(context).textSecondary,
                    ),
              ),
              if (list.truncated) ...<Widget>[
                const SizedBox(height: TpSpace.sm),
                TpCard(
                  key: WorkshopStatusKeys.truncated,
                  borderColor:
                      TpPalette.of(context).forStatus(TpStatus.warning).base,
                  child: Text(copy('truncated')),
                ),
              ],
              const SizedBox(height: TpSpace.md),
              if (visible.isEmpty)
                TpEmptyState(
                  icon: Icons.home_repair_service_outlined,
                  title: _scope == WorkshopStatusScope.mine &&
                          _query.trim().isEmpty
                      ? copy('emptyMineTitle')
                      : copy('emptyTitle'),
                  message: _scope == WorkshopStatusScope.mine &&
                          _query.trim().isEmpty
                      ? copy('emptyMineMessage')
                      : copy('emptyMessage'),
                  actionLabel: _scope == WorkshopStatusScope.mine
                      ? copy('showAll')
                      : null,
                  onAction: _scope == WorkshopStatusScope.mine
                      ? () => setState(() => _scope = WorkshopStatusScope.all)
                      : null,
                )
              else
                for (final WorkshopStatusRecord r in visible)
                  Padding(
                    padding: const EdgeInsets.only(bottom: TpSpace.sm),
                    child: _RecordTile(
                      record: r,
                      now: now,
                      isMine: r.isResponsible(userId),
                      copy: copy,
                      onTap: () => unawaited(_open(r)),
                    ),
                  ),
            ],
          ),
        );
      },
    );
  }
}

class _RecordTile extends StatelessWidget {
  const _RecordTile({
    required this.record,
    required this.now,
    required this.isMine,
    required this.copy,
    required this.onTap,
  });

  final WorkshopStatusRecord record;
  final DateTime now;
  final bool isMine;
  final WorkshopStatusCopy copy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final int? days = record.daysDown(now);
    final WorkshopFreshness fresh = record.freshness(now);
    final String? stage = record.currentStage;
    final String subtitle = <String>[
      if ((record.site ?? '').isNotEmpty) record.site!,
      if ((record.delayReason ?? '').isNotEmpty)
        copy.vocabLabel(record.delayReason!),
    ].join(' · ');

    return TpCard(
      key: WorkshopStatusKeys.row(record.id),
      onTap: onTap,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Flexible(
                      child: Text(
                        record.assetNo ?? copy('noAsset'),
                        // An asset code is a technical identifier: never
                        // reordered under a right-to-left locale.
                        textDirection: TextDirection.ltr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    if (isMine) ...<Widget>[
                      const SizedBox(width: TpSpace.sm),
                      TpStatusChip(
                        status: TpStatus.info,
                        label: copy('assignedToYou'),
                        isCompact: true,
                      ),
                    ],
                  ],
                ),
                if (subtitle.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        text.bodySmall?.copyWith(color: palette.textSecondary),
                  ),
                ],
                const SizedBox(height: TpSpace.sm),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.xs,
                  children: <Widget>[
                    TpStatusChip(
                      status: record.isReleased
                          ? TpStatus.ok
                          : (stage == null
                              ? TpStatus.unknown
                              : TpStatus.neutral),
                      label: stage == null
                          ? copy('noStage')
                          : copy.vocabLabel(stage),
                      isCompact: true,
                    ),
                    TpStatusChip(
                      status: _daysTone(days),
                      label: days == null
                          ? copy('daysUnknown')
                          : '$days ${copy('daysDown')}',
                      isCompact: true,
                    ),
                    if (fresh != WorkshopFreshness.today)
                      TpStatusChip(
                        key: WorkshopStatusKeys.staleBadge(record.id),
                        status: TpStatus.warning,
                        label: fresh == WorkshopFreshness.never
                            ? copy('neverUpdated')
                            : copy('notUpdatedToday'),
                        icon: Icons.schedule,
                        isCompact: true,
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          // The LTR icon: Flutter mirrors it under right-to-left.
          Icon(Icons.chevron_right, color: palette.textMuted),
        ],
      ),
    );
  }
}

TpStatus _daysTone(int? days) {
  if (days == null) return TpStatus.unknown;
  if (days >= 14) return TpStatus.critical;
  if (days >= 7) return TpStatus.warning;
  return TpStatus.neutral;
}

AppError _asAppError(Object error, String fallback) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: fallback,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}
