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
import 'package:tyre_pulse/features/inventory/domain/job_card_issue.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/job_card_issue_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/my_audits_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/physical_inventory_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/store_receipt_screen.dart';
import 'package:tyre_pulse/features/inventory/presentation/transfers_screen.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_recorder.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_item_detail_screen.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_screen.dart';
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
    } on Object catch (e) {
      ref.invalidate(stockItemsProvider);
      if (mounted) {
        // A count difference needs an approver (WP5): a +/- by someone
        // without adjustment_approve is refused by the server. Say so, and
        // point to the count, which is recorded for review instead.
        final String text = e is SupabaseFailure && e.isPermissionDenied
            ? copy('needsApproval')
            : copy('saveFailed');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(text)),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  /// The item's detail: levels, receive stock, and its movement history.
  Future<void> _open(StockItem item) async {
    await Navigator.of(context).push(StockItemDetailScreen.route(item));
    if (mounted) ref.invalidate(stockItemsProvider);
  }

  /// Issue this stock to a job card, or take it back from one.
  Future<void> _move(StockItem item, JobCardMove move) async {
    final bool? posted = await Navigator.of(context).push<bool>(
      JobCardIssueScreen.route(item: item, move: move),
    );
    if (posted == true) ref.invalidate(stockItemsProvider);
  }

  /// Add stock for a tyre size at a site. Recorded as a proposed new line
  /// for approval (never a direct stock write): a reviewer identifies the
  /// item and an approver posts the quantity. Reorder thresholds are set on
  /// the web once the line exists.
  Future<void> _add(StockCountCopy copy, List<StockItem> rows) async {
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;
    final List<String> sites = <String>{
      for (final StockItem row in rows)
        if ((row.site ?? '').trim().isNotEmpty) row.site!.trim(),
    }.toList()
      ..sort();
    final TextEditingController size = TextEditingController();
    final TextEditingController description = TextEditingController();
    final TextEditingController site = TextEditingController();
    final TextEditingController quantity = TextEditingController();
    bool saving = false;
    String? problem;
    String? outcome;
    await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            // While a capture is being sent the dialog cannot be dismissed
            // (back or barrier), so it cannot be reopened and sent twice.
            PopScope(
          canPop: !saving,
          child: AlertDialog(
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
                  const SizedBox(height: TpSpace.sm),
                  Text(
                    copy('addNote'),
                    key: const Key('stock.add.note'),
                    style: Theme.of(context).textTheme.bodySmall,
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
                onPressed: saving ? null : () => Navigator.pop(context, false),
                child: Text(copy('cancel')),
              ),
              FilledButton(
                key: const Key('stock.add.save'),
                onPressed: saving
                    ? null
                    : () async {
                        // In-flight guard: a second tap that lands before the
                        // rebuild disables the button would otherwise record
                        // a second capture (each send mints its own key).
                        if (saving) return;
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
                        final _AddOutcome result = await _recordNew(
                          size: size.text,
                          description: description.text,
                          site: site.text,
                          quantity: qty!,
                          copy: copy,
                        );
                        if (result.done) {
                          outcome = result.message;
                          if (context.mounted) Navigator.pop(context, true);
                        } else {
                          setDialogState(() {
                            saving = false;
                            problem = result.message;
                          });
                        }
                      },
                child: saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.5),
                      )
                    : Text(copy('add')),
              ),
            ],
          ),
        ),
      ),
    );
    size.dispose();
    description.dispose();
    site.dispose();
    quantity.dispose();
    if (outcome != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(outcome!)),
      );
    }
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
          // Inventory counts and transfers are pushed with Navigator: their
          // routes belong in reserved router files (see
          // docs/inventory_reserved_patch.md). Same `stock` module gate.
          IconButton(
            key: const Key('stock.myCounts'),
            tooltip: copy('myCounts'),
            icon: const TpIcon(Icons.fact_check_outlined),
            onPressed: () =>
                unawaited(Navigator.of(context).push(MyAuditsScreen.route())),
          ),
          IconButton(
            key: const Key('stock.physicalInventory'),
            tooltip: InventoryCopy.of(context)('pi_entry'),
            icon: const Icon(Icons.inventory_2_outlined),
            onPressed: () => unawaited(
              Navigator.of(context).push(PhysicalInventoryScreen.route()),
            ),
          ),
          // Store history: every movement, filterable. Same `stock` gate.
          IconButton(
            key: const Key('stock.history'),
            tooltip: StoreHistoryCopy.of(context)('historyTitle'),
            icon: const Icon(Icons.history_rounded),
            onPressed: () => unawaited(
              Navigator.of(context).push(StoreHistoryScreen.route()),
            ),
          ),
          // Goods received against an open PO line, sent for approval.
          IconButton(
            key: const Key('stock.receiveGoods'),
            tooltip: InventoryCopy.of(context)('sr_entry'),
            icon: const Icon(Icons.move_to_inbox_outlined),
            onPressed: () => unawaited(
              Navigator.of(context).push(StoreReceiptScreen.route()),
            ),
          ),
          IconButton(
            key: const Key('stock.transfers'),
            tooltip: copy('transfers'),
            icon: const Icon(Icons.swap_horiz_rounded),
            onPressed: () =>
                unawaited(Navigator.of(context).push(TransfersScreen.route())),
          ),
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
          // Equal-height tiles: a label that wraps (e.g. "Need reorder") must
          // not push its tile out of line with the others.
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
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
                onMove: (JobCardMove move) => unawaited(_move(item, move)),
                onOpen: () => unawaited(_open(item)),
                inventoryCopy: InventoryCopy.of(context),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }

  Future<void> _count(StockItem item, StockCountCopy copy) async {
    // Empty on purpose: the counter types what is on the shelf, not what
    // the system says.
    final TextEditingController quantity = TextEditingController();
    final TextEditingController reason = TextEditingController();
    bool saving = false;
    await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text(copy('count')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(item.description ?? copy('stockItem')),
              const SizedBox(height: TpSpace.sm),
              Text(
                copy('countNote'),
                key: const Key('stock.countNote'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
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
                      final String text = await _record(
                        item: item,
                        count: value,
                        reason: reason.text,
                        copy: copy,
                      );
                      if (context.mounted) Navigator.pop(context, true);
                      if (mounted) {
                        ScaffoldMessenger.of(this.context).showSnackBar(
                          SnackBar(content: Text(text)),
                        );
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
    // The balance does not change from a count; nothing to reload.
  }

  /// Records a new stock line for approval and returns what to show. Never
  /// throws. `done` is false only when nothing was saved, so the dialog stays
  /// open with the reason.
  Future<_AddOutcome> _recordNew({
    required String size,
    required String description,
    required String site,
    required int quantity,
    required StockCountCopy copy,
  }) async {
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return _AddOutcome(false, copy('addFailed'));
    String? device;
    try {
      device = await ref.read(inventoryDeviceIdProvider.future);
    } on Object {
      device = null;
    }
    try {
      final StockCountRecordResult r =
          await ref.read(stockCountRecorderProvider).recordNew(
                size: size,
                description: description,
                site: site,
                quantity: quantity,
                country: workspace.activeCountry,
                userId: workspace.userId,
                orgId: workspace.tenantId ?? workspace.companyId,
                deviceId: device,
              );
      return _AddOutcome(
        true,
        switch (r) {
          StockCountRecordResult.sent => copy('addRecorded'),
          StockCountRecordResult.savedOnPhone => copy('addSavedOnPhone'),
        },
      );
    } on StockCountRecordFailure catch (f) {
      return _AddOutcome(
        false,
        switch (f.problem) {
          StockCountRecordProblem.noPlace => copy('addNoCountry'),
          StockCountRecordProblem.needsConnectionForSession =>
            copy('countNeedsConnection'),
          StockCountRecordProblem.storage => copy('addFailed'),
        },
      );
    } on StockCountRefused catch (r) {
      // The line is kept on the phone with the reason (Physical inventory
      // lists it under needs attention), so the dialog can close.
      return _AddOutcome(true, '${copy('addRefused')} ${r.message}');
    } on SupabaseFailure catch (f) {
      return _AddOutcome(false, f.error.message);
    } on Object {
      return _AddOutcome(false, copy('addFailed'));
    }
  }

  /// Records the count as physical count evidence and returns the sentence
  /// to show. Never throws: every outcome is a message, and the count is kept
  /// on the phone whenever it could be saved at all.
  Future<String> _record({
    required StockItem item,
    required num count,
    required String reason,
    required StockCountCopy copy,
  }) async {
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return copy('saveFailed');
    String? device;
    try {
      device = await ref.read(inventoryDeviceIdProvider.future);
    } on Object {
      device = null;
    }
    try {
      final StockCountRecordResult r =
          await ref.read(stockCountRecorderProvider).record(
                item: item,
                count: count,
                reason: reason,
                userId: workspace.userId,
                // app_current_org() reads profiles.org_id; the server checks
                // photo paths against it.
                orgId: workspace.tenantId ?? workspace.companyId,
                fallbackCountry: workspace.activeCountry,
                deviceId: device,
              );
      return switch (r) {
        StockCountRecordResult.sent => copy('countRecorded'),
        StockCountRecordResult.savedOnPhone => copy('countSavedOnPhone'),
      };
    } on StockCountRecordFailure catch (f) {
      return switch (f.problem) {
        StockCountRecordProblem.noPlace => copy('countNoPlace'),
        StockCountRecordProblem.needsConnectionForSession =>
          copy('countNeedsConnection'),
        StockCountRecordProblem.storage => copy('saveFailed'),
      };
    } on StockCountRefused catch (r) {
      return '${copy('countRefused')} ${r.message}';
    } on SupabaseFailure catch (f) {
      return f.error.message;
    } on Object {
      return copy('saveFailed');
    }
  }
}

final class _AddOutcome {
  const _AddOutcome(this.done, this.message);
  final bool done;
  final String message;
}

class _Metric extends StatelessWidget {
  const _Metric({required this.value, required this.label});
  final int value;
  final String label;

  @override
  Widget build(BuildContext context) => TpCard(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text('$value', style: Theme.of(context).textTheme.headlineSmall),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
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
    required this.onMove,
    required this.inventoryCopy,
    required this.busy,
    this.onOpen,
  });
  final StockItem item;
  final VoidCallback? onOpen;
  final StockCountCopy copy;
  final InventoryCopy inventoryCopy;
  final VoidCallback onCount;
  final ValueChanged<int> onAdjust;
  final ValueChanged<JobCardMove> onMove;
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
      onTap: onOpen,
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
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  TextButton(onPressed: onCount, child: Text(copy('count'))),
                  PopupMenuButton<JobCardMove>(
                    key: Key('stock.moves.${item.id}'),
                    tooltip: inventoryCopy('jc_menu'),
                    enabled: !busy,
                    onSelected: onMove,
                    icon: const Icon(Icons.more_vert_rounded),
                    itemBuilder: (BuildContext context) =>
                        <PopupMenuEntry<JobCardMove>>[
                      PopupMenuItem<JobCardMove>(
                        key: Key('stock.issue.${item.id}'),
                        value: JobCardMove.issue,
                        child: Text(inventoryCopy('jc_issueTitle')),
                      ),
                      PopupMenuItem<JobCardMove>(
                        key: Key('stock.return.${item.id}'),
                        value: JobCardMove.issueReturn,
                        child: Text(inventoryCopy('jc_returnTitle')),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }
}
