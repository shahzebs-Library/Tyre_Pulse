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

  /// The genuine / not genuine mark chosen on a line before "Matches" (and
  /// the starting choice in the count dialog). Null = not stated.
  final Map<String, bool?> _genuine = <String, bool?>{};

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
    bool saving = false;
    String? problem;
    String? outcome;
    await showDialog<bool>(
      context: context,
      // The dialog route owns its controllers (disposed only once the route
      // has finished animating out; see [_CountDialog] for the crash this
      // avoids).
      builder: (BuildContext dialogContext) => _OwnedControllers(
        count: 4,
        builder: (BuildContext context, List<TextEditingController> c) {
          final TextEditingController size = c[0];
          final TextEditingController description = c[1];
          final TextEditingController site = c[2];
          final TextEditingController quantity = c[3];
          return StatefulBuilder(
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
                        decoration:
                            InputDecoration(labelText: copy('description')),
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
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: false,
                        ),
                        decoration:
                            InputDecoration(labelText: copy('quantity')),
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
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                actions: <Widget>[
                  TextButton(
                    onPressed:
                        saving ? null : () => Navigator.pop(context, false),
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
          );
        },
      ),
    );
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
          // At most three icons on a phone bar; the rest sit in a labelled
          // overflow menu. Counts, transfers and receipts are pushed with
          // Navigator: their routes belong in reserved router files (see
          // docs/inventory_reserved_patch.md). Same `stock` module gate.
          // Goods received against an open PO line, sent for approval.
          IconButton(
            key: const Key('stock.receiveGoods'),
            tooltip: InventoryCopy.of(context)('sr_entry'),
            icon: const Icon(Icons.move_to_inbox_outlined),
            onPressed: () => unawaited(
              Navigator.of(context).push(StoreReceiptScreen.route()),
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
          PopupMenuButton<String>(
            key: const Key('stock.more'),
            tooltip: InventoryCopy.of(context)('sr_more'),
            onSelected: (String v) {
              final NavigatorState nav = Navigator.of(context);
              switch (v) {
                case 'counts':
                  unawaited(nav.push(MyAuditsScreen.route()));
                case 'physical':
                  unawaited(nav.push(PhysicalInventoryScreen.route()));
                case 'transfers':
                  unawaited(nav.push(TransfersScreen.route()));
                case 'add':
                  unawaited(
                    _add(
                      copy,
                      switch (state) {
                        AsyncData<List<StockItem>>(:final value) => value,
                        _ => const <StockItem>[],
                      },
                    ),
                  );
              }
            },
            itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
              PopupMenuItem<String>(
                key: const Key('stock.add'),
                value: 'add',
                child: ListTile(
                  leading: const Icon(Icons.add_rounded),
                  title: Text(copy('add')),
                ),
              ),
              PopupMenuItem<String>(
                key: const Key('stock.myCounts'),
                value: 'counts',
                child: ListTile(
                  leading: const TpIcon(Icons.fact_check_outlined),
                  title: Text(copy('myCounts')),
                ),
              ),
              PopupMenuItem<String>(
                key: const Key('stock.physicalInventory'),
                value: 'physical',
                child: ListTile(
                  leading: const Icon(Icons.inventory_2_outlined),
                  title: Text(InventoryCopy.of(context)('pi_entry')),
                ),
              ),
              PopupMenuItem<String>(
                key: const Key('stock.transfers'),
                value: 'transfers',
                child: ListTile(
                  leading: const Icon(Icons.swap_horiz_rounded),
                  title: Text(copy('transfers')),
                ),
              ),
            ],
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
    final Map<String, DateTime> local = ref.watch(stockCountedTodayProvider);
    final bool canAdjust = ref.watch(canPostCountDifferenceProvider);
    bool counted(StockItem row) => stockLineCountedToday(row, now, local);
    final int low = rows.where((StockItem row) => row.needsReorder).length;
    final int stale = rows.where((StockItem row) => !counted(row)).length;
    final String term = _search.text.trim().toLowerCase();
    final List<StockItem> visible = rows.where((StockItem row) {
      final bool filterMatch = switch (_filter) {
        _StockFilter.all => true,
        _StockFilter.low => row.needsReorder,
        _StockFilter.stale => !counted(row),
      };
      if (!filterMatch) return false;
      if (term.isEmpty) return true;
      return <String?>[
        row.description,
        row.site,
        row.locationCode,
        row.itemCode,
      ].any((String? v) => (v ?? '').toLowerCase().contains(term));
    }).toList(growable: false);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(stockItemsProvider);
        await ref.read(stockItemsProvider.future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        // A scroll puts the keyboard away so it never covers the list.
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
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
            // Never opens the keyboard on entry; a tap outside closes it.
            autofocus: false,
            onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => FocusManager.instance.primaryFocus?.unfocus(),
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
                canAdjust: canAdjust,
                countedToday: counted(item),
                genuine: _genuine[item.id],
                onGenuine: (bool? value) =>
                    setState(() => _genuine[item.id] = value),
                onMatches: () => unawaited(_matches(item, copy)),
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

  /// "Doesn't match" (and Count for an approver): the person types what is
  /// on the shelf. The dialog owns its text controllers (see [_CountDialog]),
  /// so nothing it renders is disposed while its route is still animating
  /// out.
  Future<void> _count(StockItem item, StockCountCopy copy) async {
    final String? message = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => _CountDialog(
        item: item,
        copy: copy,
        initialGenuine: _genuine[item.id],
        onSave: (_CountInput input) async {
          _genuine[item.id] = input.genuine;
          final _CountOutcome outcome = await _record(
            item: item,
            count: input.count,
            reason: input.reason,
            genuine: input.genuine,
            genuineNote: input.genuineNote,
            copy: copy,
          );
          return outcome.message;
        },
      ),
    );
    if (message != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
    // The balance does not change from a count; nothing to reload.
  }

  /// "Matches": one tap records a physical count equal to the system
  /// quantity, through the same path as the count dialog.
  Future<void> _matches(StockItem item, StockCountCopy copy) async {
    if (_busyId != null) return;
    setState(() => _busyId = item.id);
    final _CountOutcome outcome = await _record(
      item: item,
      count: item.quantity,
      reason: null,
      genuine: _genuine[item.id],
      genuineNote: null,
      copy: copy,
      matches: true,
    );
    if (!mounted) return;
    setState(() => _busyId = null);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(outcome.message)),
    );
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
  Future<_CountOutcome> _record({
    required StockItem item,
    required num count,
    required String? reason,
    required bool? genuine,
    required String? genuineNote,
    required StockCountCopy copy,
    bool matches = false,
  }) async {
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return _CountOutcome.failed(copy('saveFailed'));
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
                genuine: genuine,
                genuineNote: genuineNote,
              );
      // Saved (sent, or on the phone): this line has been counted today.
      if (mounted) {
        ref
            .read(stockCountedTodayProvider.notifier)
            .mark(item.id, DateTime.now());
      }
      return _CountOutcome.saved(
        switch (r) {
          StockCountRecordResult.sent =>
            copy(matches ? 'matchesRecorded' : 'countRecorded'),
          StockCountRecordResult.savedOnPhone =>
            copy(matches ? 'matchesSavedOnPhone' : 'countSavedOnPhone'),
        },
      );
    } on StockCountRecordFailure catch (f) {
      return _CountOutcome.failed(
        switch (f.problem) {
          StockCountRecordProblem.noPlace => copy('countNoPlace'),
          StockCountRecordProblem.needsConnectionForSession =>
            copy('countNeedsConnection'),
          StockCountRecordProblem.storage => copy('saveFailed'),
        },
      );
    } on StockCountRefused catch (r) {
      return _CountOutcome.failed('${copy('countRefused')} ${r.message}');
    } on SupabaseFailure catch (f) {
      return _CountOutcome.failed(f.error.message);
    } on Object {
      return _CountOutcome.failed(copy('saveFailed'));
    }
  }
}

/// Creates [count] text controllers for a dialog and disposes them with the
/// dialog's own element, after its route has finished animating out.
class _OwnedControllers extends StatefulWidget {
  const _OwnedControllers({required this.count, required this.builder});
  final int count;
  final Widget Function(BuildContext, List<TextEditingController>) builder;

  @override
  State<_OwnedControllers> createState() => _OwnedControllersState();
}

class _OwnedControllersState extends State<_OwnedControllers> {
  late final List<TextEditingController> _controllers =
      List<TextEditingController>.generate(
    widget.count,
    (_) => TextEditingController(),
  );

  @override
  void dispose() {
    for (final TextEditingController c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _controllers);
}

final class _CountOutcome {
  const _CountOutcome.saved(this.message) : saved = true;
  const _CountOutcome.failed(this.message) : saved = false;
  final String message;
  final bool saved;
}

/// What the count dialog hands back on Save.
final class _CountInput {
  const _CountInput({
    required this.count,
    required this.reason,
    required this.genuine,
    required this.genuineNote,
  });
  final num count;
  final String reason;
  final bool? genuine;
  final String? genuineNote;
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
    required this.canAdjust,
    required this.countedToday,
    required this.genuine,
    required this.onGenuine,
    required this.onMatches,
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

  /// True for someone the server lets post a count difference (+/-).
  final bool canAdjust;
  final bool countedToday;
  final bool? genuine;
  final ValueChanged<bool?> onGenuine;
  final VoidCallback onMatches;
  final VoidCallback onCount;
  final ValueChanged<int> onAdjust;
  final ValueChanged<JobCardMove> onMove;
  final bool busy;

  /// What tells this line apart from another with the same description:
  /// bin, item code, condition, ownership and unit.
  String? _identity() {
    final List<String> parts = <String>[
      if ((item.locationCode ?? '').isNotEmpty)
        '${copy('bin')} ${item.locationCode}',
      if ((item.itemCode ?? '').isNotEmpty) '${copy('code')} ${item.itemCode}',
      if ((item.condition ?? '').isNotEmpty) item.condition!,
      if ((item.ownership ?? '').isNotEmpty) item.ownership!,
      if ((item.uom ?? '').isNotEmpty) item.uom!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }

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
    final String? identity = _identity();
    final Widget moves = PopupMenuButton<JobCardMove>(
      key: Key('stock.moves.${item.id}'),
      tooltip: inventoryCopy('jc_menu'),
      enabled: !busy,
      onSelected: onMove,
      icon: const Icon(Icons.more_vert_rounded),
      itemBuilder: (BuildContext context) => <PopupMenuEntry<JobCardMove>>[
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
    );
    final Widget details = Column(
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
        if (identity != null)
          Text(
            identity,
            key: Key('stock.identity.${item.id}'),
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: palette.textSecondary),
          ),
        const SizedBox(height: TpSpace.xs),
        Wrap(
          spacing: TpSpace.xs,
          runSpacing: TpSpace.xs,
          children: <Widget>[
            TpStatusChip(status: tpStatus, label: copy(status)),
            if (countedToday)
              TpStatusChip(
                key: Key('stock.countedToday.${item.id}'),
                status: TpStatus.info,
                label: copy('countedToday'),
              ),
          ],
        ),
      ],
    );
    final Widget icon = DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: const Padding(
        padding: EdgeInsets.all(TpSpace.md),
        child: Icon(Icons.inventory_2_outlined),
      ),
    );

    if (canAdjust) {
      // An approver keeps +/- (each tap is an audited movement) and Count.
      return TpCard(
        key: Key('stock.item.${item.id}'),
        onTap: onOpen,
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          children: <Widget>[
            icon,
            const SizedBox(width: TpSpace.md),
            Expanded(child: details),
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
                      onPressed: busy || item.quantity <= 0
                          ? null
                          : () => onAdjust(-1),
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
                    TextButton(
                      key: Key('stock.count.${item.id}'),
                      onPressed: onCount,
                      child: Text(copy('count')),
                    ),
                    moves,
                  ],
                ),
              ],
            ),
          ],
        ),
      );
    }

    // Everyone else counts: the shelf either matches the system or it does
    // not. A +/- here would always be refused by the server (WP5).
    return TpCard(
      key: Key('stock.item.${item.id}'),
      onTap: onOpen,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              icon,
              const SizedBox(width: TpSpace.md),
              Expanded(child: details),
              const SizedBox(width: TpSpace.sm),
              Column(
                children: <Widget>[
                  Text(
                    '${item.quantity}',
                    key: Key('stock.qty.${item.id}'),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text(copy('onHand')),
                ],
              ),
              moves,
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          _GenuineChoice(
            keyPrefix: 'stock.genuine.${item.id}',
            copy: copy,
            value: genuine,
            onChanged: busy ? null : onGenuine,
          ),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            alignment: WrapAlignment.end,
            children: <Widget>[
              FilledButton.tonalIcon(
                key: Key('stock.matches.${item.id}'),
                onPressed: busy ? null : onMatches,
                icon: busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2.2),
                      )
                    : const Icon(Icons.check_circle_outline_rounded),
                label: Text(copy('matches')),
              ),
              OutlinedButton.icon(
                key: Key('stock.notMatch.${item.id}'),
                onPressed: busy ? null : onCount,
                icon: const Icon(Icons.edit_note_rounded),
                label: Text(copy('notMatch')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Genuine / Not genuine, both optional: tapping the chosen one again clears
/// it (not stated).
class _GenuineChoice extends StatelessWidget {
  const _GenuineChoice({
    required this.keyPrefix,
    required this.copy,
    required this.value,
    required this.onChanged,
  });
  final String keyPrefix;
  final StockCountCopy copy;
  final bool? value;
  final ValueChanged<bool?>? onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: TpSpace.xs,
        runSpacing: TpSpace.xs,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(
            copy('genuineQuestion'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          ChoiceChip(
            key: Key('$keyPrefix.yes'),
            label: Text(copy('genuine')),
            selected: value == true,
            onSelected: onChanged == null
                ? null
                : (bool on) => onChanged!(on ? true : null),
          ),
          ChoiceChip(
            key: Key('$keyPrefix.no'),
            label: Text(copy('notGenuine')),
            selected: value == false,
            onSelected: onChanged == null
                ? null
                : (bool on) => onChanged!(on ? false : null),
          ),
        ],
      );
}

/// The count dialog. It OWNS its controllers and disposes them in its own
/// [State.dispose], which runs only after the route has finished animating
/// out.
///
/// Root cause of the "Save count" crash (framework.dart
/// `_dependents.isEmpty`): the controllers used to be created by the screen,
/// and disposed on the line after `await showDialog(...)`. That future
/// completes as soon as `Navigator.pop` is called, while the dialog's
/// TextFields are still mounted for the exit transition, so the next frame
/// rebuilt EditableText against a disposed controller and the element tree
/// was torn down mid-failure.
class _CountDialog extends StatefulWidget {
  const _CountDialog({
    required this.item,
    required this.copy,
    required this.initialGenuine,
    required this.onSave,
  });
  final StockItem item;
  final StockCountCopy copy;
  final bool? initialGenuine;

  /// Records the count and returns the sentence to show. Never throws.
  final Future<String> Function(_CountInput input) onSave;

  @override
  State<_CountDialog> createState() => _CountDialogState();
}

class _CountDialogState extends State<_CountDialog> {
  // Empty on purpose: the counter types what is on the shelf, not what the
  // system says.
  final TextEditingController _quantity = TextEditingController();
  final TextEditingController _reason = TextEditingController();
  final TextEditingController _note = TextEditingController();
  late bool? _genuine = widget.initialGenuine;
  bool _saving = false;
  String? _problem;

  @override
  void dispose() {
    _quantity.dispose();
    _reason.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    // In-flight guard: a second tap before the rebuild must not record twice.
    if (_saving) return;
    final num? value = num.tryParse(_quantity.text.trim());
    if (value == null || value < 0) {
      setState(() => _problem = widget.copy('invalid'));
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _saving = true;
      _problem = null;
    });
    final String message = await widget.onSave(
      _CountInput(
        count: value,
        reason: _reason.text,
        genuine: _genuine,
        genuineNote: _note.text,
      ),
    );
    if (!mounted) return;
    Navigator.of(context).pop(message);
  }

  @override
  Widget build(BuildContext context) {
    final StockCountCopy copy = widget.copy;
    return PopScope(
      // While the count is being sent the dialog cannot be dismissed.
      canPop: !_saving,
      child: AlertDialog(
        title: Text(copy('count')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(widget.item.description ?? copy('stockItem')),
              const SizedBox(height: TpSpace.sm),
              Text(
                copy('countNote'),
                key: const Key('stock.countNote'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: TpSpace.md),
              TextField(
                key: const Key('stock.quantity'),
                controller: _quantity,
                autofocus: true,
                enabled: !_saving,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: false),
                decoration: InputDecoration(
                  labelText: copy('physicalCount'),
                  errorText: _problem,
                ),
              ),
              TextField(
                key: const Key('stock.reason'),
                controller: _reason,
                enabled: !_saving,
                decoration: InputDecoration(labelText: copy('reason')),
              ),
              const SizedBox(height: TpSpace.md),
              _GenuineChoice(
                keyPrefix: 'stock.dialog.genuine',
                copy: copy,
                value: _genuine,
                onChanged:
                    _saving ? null : (bool? v) => setState(() => _genuine = v),
              ),
              if (_genuine != null)
                TextField(
                  key: const Key('stock.genuineNote'),
                  controller: _note,
                  enabled: !_saving,
                  decoration: InputDecoration(labelText: copy('genuineNote')),
                ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: Text(copy('cancel')),
          ),
          FilledButton(
            key: const Key('stock.save'),
            onPressed: _saving ? null : () => unawaited(_save()),
            child: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2.5),
                  )
                : Text(copy('save')),
          ),
        ],
      ),
    );
  }
}
