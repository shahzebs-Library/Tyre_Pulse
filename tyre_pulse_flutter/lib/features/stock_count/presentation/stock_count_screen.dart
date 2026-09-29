library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_copy.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';

enum _StockFilter { all, low, stale }

class StockCountScreen extends ConsumerStatefulWidget {
  const StockCountScreen({required this.route, super.key});
  final StockCountRoute route;

  @override
  ConsumerState<StockCountScreen> createState() => _StockCountScreenState();
}

class _StockCountScreenState extends ConsumerState<StockCountScreen> {
  final TextEditingController _search = TextEditingController();
  _StockFilter _filter = _StockFilter.all;
  String? _busyId;

  /// Quick +/- (Expo `quickAdjust`): one audited movement per tap.
  Future<void> _adjust(StockItem item, int delta, StockCountCopy copy) async {
    if (_busyId != null) return;
    if (delta < 0 && item.quantity <= 0) return;
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;
    setState(() => _busyId = item.id);
    try {
      final bool queued = await ref
          .read(stockCountRepositoryProvider)
          .adjust(item: item, delta: delta, workspace: workspace);
      ref.invalidate(stockItemsProvider);
      if (queued && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(copy('offlineSaved'))),
        );
      }
    } on Object {
      ref.invalidate(stockItemsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(copy('saveFailed'))),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  /// Add a stock row for a tyre size at a site (Expo `openAdd`/`submitAdd`).
  /// Reorder thresholds are offered to Admin and super admin only; everyone
  /// else leaves them to the server defaults.
  Future<void> _add(StockCountCopy copy, List<StockItem> rows) async {
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;
    final bool mayEditThresholds =
        workspace.role.isAdministrator || workspace.isSuperAdmin;
    final List<String> sites = <String>{
      for (final StockItem row in rows)
        if ((row.site ?? '').trim().isNotEmpty) row.site!.trim(),
    }.toList()
      ..sort();
    final TextEditingController size = TextEditingController();
    final TextEditingController description = TextEditingController();
    final TextEditingController site = TextEditingController();
    final TextEditingController quantity = TextEditingController();
    final TextEditingController minimum = TextEditingController(text: '5');
    final TextEditingController critical = TextEditingController(text: '3');
    bool saving = false;
    String? problem;
    final bool? saved = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text(copy('addTitle')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  key: const Key('stock.add.size'),
                  controller: size,
                  autofocus: true,
                  decoration: InputDecoration(labelText: copy('size')),
                ),
                TextField(
                  key: const Key('stock.add.description'),
                  controller: description,
                  decoration: InputDecoration(labelText: copy('description')),
                ),
                TextField(
                  key: const Key('stock.add.site'),
                  controller: site,
                  decoration: InputDecoration(labelText: copy('site')),
                ),
                if (sites.isNotEmpty) ...<Widget>[
                  const SizedBox(height: TpSpace.xs),
                  Wrap(
                    spacing: TpSpace.xs,
                    runSpacing: TpSpace.xs,
                    children: <Widget>[
                      for (final String option in sites)
                        ActionChip(
                          label: Text(option),
                          onPressed: () =>
                              setDialogState(() => site.text = option),
                        ),
                    ],
                  ),
                ],
                TextField(
                  key: const Key('stock.add.quantity'),
                  controller: quantity,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: false),
                  decoration: InputDecoration(labelText: copy('quantity')),
                ),
                if (mayEditThresholds) ...<Widget>[
                  TextField(
                    key: const Key('stock.add.min'),
                    controller: minimum,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: false),
                    decoration: InputDecoration(labelText: copy('minLevel')),
                  ),
                  TextField(
                    key: const Key('stock.add.critical'),
                    controller: critical,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: false),
                    decoration:
                        InputDecoration(labelText: copy('criticalLevel')),
                  ),
                ],
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
              onPressed: saving ? null : () => Navigator.pop(context, false),
              child: Text(copy('cancel')),
            ),
            FilledButton(
              key: const Key('stock.add.save'),
              onPressed: saving
                  ? null
                  : () async {
                      final int? qty = int.tryParse(quantity.text.trim());
                      final String? issue = size.text.trim().isEmpty
                          ? copy('sizeRequired')
                          : site.text.trim().isEmpty
                              ? copy('siteRequired')
                              : (qty == null || qty < 0)
                                  ? copy('invalid')
                                  : null;
                      if (issue != null) {
                        setDialogState(() => problem = issue);
                        return;
                      }
                      setDialogState(() {
                        saving = true;
                        problem = null;
                      });
                      try {
                        await ref.read(stockCountRepositoryProvider).create(
                              size: size.text,
                              description: description.text,
                              site: site.text,
                              quantity: qty!,
                              workspace: workspace,
                              writeThresholds: mayEditThresholds,
                              minLevel: int.tryParse(minimum.text.trim()),
                              criticalLevel: int.tryParse(critical.text.trim()),
                            );
                        if (context.mounted) Navigator.pop(context, true);
                      } on Object {
                        setDialogState(() {
                          saving = false;
                          problem = copy('addFailed');
                        });
                      }
                    },
              child: Text(copy('add')),
            ),
          ],
        ),
      ),
    );
    size.dispose();
    description.dispose();
    site.dispose();
    quantity.dispose();
    minimum.dispose();
    critical.dispose();
    if (saved == true) ref.invalidate(stockItemsProvider);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final StockCountCopy copy = StockCountCopy.of(context);
    final AsyncValue<List<StockItem>> state = ref.watch(stockItemsProvider);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: switch (state) {
          AsyncData<List<StockItem>>(:final value) =>
            '${value.length} ${copy('items')}',
          _ => null,
        },
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            key: const Key('stock.add'),
            tooltip: copy('add'),
            icon: const Icon(Icons.add_rounded),
            onPressed: () => unawaited(
              _add(
                copy,
                switch (state) {
                  AsyncData<List<StockItem>>(:final value) => value,
                  _ => const <StockItem>[],
                },
              ),
            ),
          ),
        ],
      ),
      body: state.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace stackTrace) => TpErrorState(
          error: switch (error) {
            final SupabaseFailure failure => failure.error,
            final AppError appError => appError,
            _ => AppError(
                kind: AppErrorKind.unknown,
                message: copy('loadFailed'),
                cause: error,
                isRetryable: true,
              ),
          },
          onRetry: () => ref.invalidate(stockItemsProvider),
        ),
        data: (List<StockItem> rows) => _content(copy, rows),
      ),
    );
  }

  Widget _content(StockCountCopy copy, List<StockItem> rows) {
    final DateTime now = DateTime.now();
    final int low = rows.where((StockItem row) => row.needsReorder).length;
    final int stale =
        rows.where((StockItem row) => !row.countedToday(now)).length;
    final String term = _search.text.trim().toLowerCase();
    final List<StockItem> visible = rows.where((StockItem row) {
      final bool filterMatch = switch (_filter) {
        _StockFilter.all => true,
        _StockFilter.low => row.needsReorder,
        _StockFilter.stale => !row.countedToday(now),
      };
      if (!filterMatch) return false;
      if (term.isEmpty) return true;
      return (row.description ?? '').toLowerCase().contains(term) ||
          (row.site ?? '').toLowerCase().contains(term);
    }).toList(growable: false);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(stockItemsProvider);
        await ref.read(stockItemsProvider.future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: _Metric(value: rows.length, label: copy('items')),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: _Metric(value: low, label: copy('reorder'))),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: _Metric(value: stale, label: copy('notToday'))),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          TextField(
            key: const Key('stock.search'),
            controller: _search,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search_rounded),
              hintText: copy('search'),
              suffixIcon: term.isEmpty
                  ? null
                  : IconButton(
                      onPressed: () => setState(_search.clear),
                      icon: const Icon(Icons.close_rounded),
                    ),
            ),
          ),
          const SizedBox(height: TpSpace.sm),
          SegmentedButton<_StockFilter>(
            segments: <ButtonSegment<_StockFilter>>[
              ButtonSegment<_StockFilter>(
                value: _StockFilter.all,
                label: Text(copy('all')),
              ),
              ButtonSegment<_StockFilter>(
                value: _StockFilter.low,
                label: Text(copy('low')),
              ),
              ButtonSegment<_StockFilter>(
                value: _StockFilter.stale,
                label: Text(copy('stale')),
              ),
            ],
            selected: <_StockFilter>{_filter},
            onSelectionChanged: (Set<_StockFilter> value) =>
                setState(() => _filter = value.single),
          ),
          const SizedBox(height: TpSpace.md),
          if (visible.isEmpty)
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.4,
              child: TpEmptyState(
                icon: Icons.inventory_2_outlined,
                title: copy('empty'),
                message: copy('emptyBody'),
              ),
            )
          else
            for (final StockItem item in visible) ...<Widget>[
              _StockCard(
                item: item,
                copy: copy,
                onCount: () => unawaited(_count(item, copy)),
                busy: _busyId == item.id,
                onAdjust: (int delta) => unawaited(_adjust(item, delta, copy)),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }

  Future<void> _count(StockItem item, StockCountCopy copy) async {
    final TextEditingController quantity =
        TextEditingController(text: '${item.quantity}');
    final TextEditingController reason = TextEditingController();
    bool saving = false;
    final bool? saved = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text(copy('count')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(item.description ?? copy('stockItem')),
              const SizedBox(height: TpSpace.md),
              TextField(
                key: const Key('stock.quantity'),
                controller: quantity,
                autofocus: true,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: false),
                decoration: InputDecoration(labelText: copy('physicalCount')),
              ),
              TextField(
                key: const Key('stock.reason'),
                controller: reason,
                decoration: InputDecoration(labelText: copy('reason')),
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(context, false),
              child: Text(copy('cancel')),
            ),
            FilledButton(
              key: const Key('stock.save'),
              onPressed: saving
                  ? null
                  : () async {
                      final num? value = num.tryParse(quantity.text.trim());
                      if (value == null || value < 0) {
                        ScaffoldMessenger.of(this.context).showSnackBar(
                          SnackBar(content: Text(copy('invalid'))),
                        );
                        return;
                      }
                      setDialogState(() => saving = true);
                      try {
                        final workspace = ref.read(workspaceContextProvider);
                        if (workspace == null) throw StateError('workspace');
                        final bool queued = await ref
                            .read(stockCountRepositoryProvider)
                            .setCount(
                              item: item,
                              count: value,
                              reason: reason.text,
                              workspace: workspace,
                            );
                        if (context.mounted) Navigator.pop(context, true);
                        if (queued && mounted) {
                          ScaffoldMessenger.of(this.context).showSnackBar(
                            SnackBar(content: Text(copy('offlineSaved'))),
                          );
                        }
                      } on Object {
                        setDialogState(() => saving = false);
                        if (mounted) {
                          ScaffoldMessenger.of(this.context).showSnackBar(
                            SnackBar(content: Text(copy('saveFailed'))),
                          );
                        }
                      }
                    },
              child: Text(copy('save')),
            ),
          ],
        ),
      ),
    );
    quantity.dispose();
    reason.dispose();
    if (saved == true) ref.invalidate(stockItemsProvider);
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.value, required this.label});
  final int value;
  final String label;

  @override
  Widget build(BuildContext context) => TpCard(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          children: <Widget>[
            Text('$value', style: Theme.of(context).textTheme.headlineSmall),
            Text(label, textAlign: TextAlign.center),
          ],
        ),
      );
}

class _StockCard extends StatelessWidget {
  const _StockCard({
    required this.item,
    required this.copy,
    required this.onCount,
    required this.onAdjust,
    required this.busy,
  });
  final StockItem item;
  final StockCountCopy copy;
  final VoidCallback onCount;
  final ValueChanged<int> onAdjust;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String status = stockStatus(
      item.quantity,
      item.minimum,
      item.critical,
    );
    final TpStatus tpStatus = switch (status) {
      'Critical' => TpStatus.critical,
      'Low' => TpStatus.warning,
      _ => TpStatus.ok,
    };
    return TpCard(
      key: Key('stock.item.${item.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: const Padding(
              padding: EdgeInsets.all(TpSpace.md),
              child: Icon(Icons.inventory_2_outlined),
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.description ?? copy('stockItem'),
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                if (item.site != null)
                  Text(
                    item.site!,
                    style: TextStyle(color: palette.textSecondary),
                  ),
                const SizedBox(height: TpSpace.xs),
                TpStatusChip(status: tpStatus, label: copy(status)),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Column(
            children: <Widget>[
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  IconButton(
                    key: Key('stock.decrease.${item.id}'),
                    tooltip: copy('decrease'),
                    visualDensity: VisualDensity.compact,
                    onPressed:
                        busy || item.quantity <= 0 ? null : () => onAdjust(-1),
                    icon: const Icon(Icons.remove_circle_outline_rounded),
                  ),
                  Text(
                    '${item.quantity}',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  IconButton(
                    key: Key('stock.increase.${item.id}'),
                    tooltip: copy('increase'),
                    visualDensity: VisualDensity.compact,
                    onPressed: busy ? null : () => onAdjust(1),
                    icon: const Icon(Icons.add_circle_outline_rounded),
                  ),
                ],
              ),
              Text(copy('onHand')),
              TextButton(onPressed: onCount, child: Text(copy('count'))),
            ],
          ),
        ],
      ),
    );
  }
}
