library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show CustomSemanticsAction;
import 'package:flutter/services.dart';
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
import 'package:tyre_pulse/features/stock_count/domain/store_item_card.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_copy.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_history_screen.dart';
import 'package:tyre_pulse/features/stock_count/presentation/store_item_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_providers.dart';
import 'package:tyre_pulse/features/stock_count/store_item_providers.dart';

class StockCountScreen extends ConsumerStatefulWidget {
  const StockCountScreen({required this.route, super.key});
  final StockCountRoute route;

  @override
  ConsumerState<StockCountScreen> createState() => _StockCountScreenState();
}

class _StockCountScreenState extends ConsumerState<StockCountScreen> {
  final TextEditingController _search = TextEditingController();
  StockCountFilter _filter = StockCountFilter.all;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    // Home's store tiles ask for a filter ("Need reorder" -> low stock,
    // "Not counted" -> not counted today, "Items" -> all).
    _filter =
        ref.read(stockCountRequestedFilterProvider) ?? StockCountFilter.all;
    // Cleared after the first frame: a provider may not change during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(stockCountRequestedFilterProvider.notifier).take();
    });
    ref.listenManual<StockCountFilter?>(stockCountRequestedFilterProvider, (
      StockCountFilter? previous,
      StockCountFilter? next,
    ) {
      if (next == null || !mounted) return;
      final StockCountFilter? f =
          ref.read(stockCountRequestedFilterProvider.notifier).take();
      if (f != null) setState(() => _filter = f);
    });
  }

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

  /// The item card: photo, where it is, part numbers, brand, movements;
  /// levels and receiving stay one tap further on its app bar.
  Future<void> _open(
    StockItem item, {
    required StockCountCopy copy,
    required bool canAdjust,
  }) async {
    await Navigator.of(context).push(
      StoreItemScreen.route(
        item,
        countPanel: (BuildContext context) => _CountPanel(
          item: item,
          canAdjust: canAdjust,
          initialGenuine: _genuine[item.id],
          onGenuine: (bool? value) => _genuine[item.id] = value,
          onMatches: () => _matches(item, copy),
          onCount: () => _count(item, copy),
          onAdjust: (int delta) => _adjust(item, delta, copy),
          onMove: (JobCardMove move) => _move(item, move),
        ),
      ),
    );
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
    // The last list that loaded: shown while a reload runs or after it failed
    // (offline), so the shelf never disappears behind a spinner.
    final List<StockItem>? cached = ref.watch(
      lastStockItemsProvider.select(
        (Map<String, List<StockItem>> m) =>
            m[LastStockItemsNotifier.keyFor(ref.watch(activeCountryProvider))],
      ),
    );
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
      body: _body(copy, state, cached),
    );
  }

  /// The list, kept on screen from the last good load while a reload runs
  /// or after it failed, with a banner saying so. A full screen spinner or
  /// error only when nothing was ever loaded.
  Widget _body(
    StockCountCopy copy,
    AsyncValue<List<StockItem>> state,
    List<StockItem>? cached,
  ) {
    if (state is AsyncData<List<StockItem>>) return _content(copy, state.value);
    final List<StockItem>? last = cached ?? state.asData?.value;
    if (state.isLoading) {
      return last == null
          ? const TpLoadingState()
          : _content(copy, last, banner: _ListBanner.refreshing);
    }
    final Object? error = state.error;
    if (last != null) {
      return _content(
        copy,
        last,
        banner: error is SupabaseFailure && error.isConnectivity
            ? _ListBanner.offline
            : _ListBanner.refreshFailed,
      );
    }
    return TpErrorState(
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
    );
  }

  Widget _content(
    StockCountCopy copy,
    List<StockItem> rows, {
    _ListBanner? banner,
  }) {
    // One thumbnail / brand read for the whole register, not per filter.
    final String facesKey = stockFacesKey(rows);
    final DateTime now = DateTime.now();
    final Map<String, DateTime> local = ref.watch(stockCountedTodayProvider);
    final bool canAdjust = ref.watch(canPostCountDifferenceProvider);
    bool counted(StockItem row) => stockLineCountedToday(row, now, local);
    final int low = rows.where((StockItem row) => row.needsReorder).length;
    final int stale = rows.where((StockItem row) => !counted(row)).length;
    final String term = _search.text.trim().toLowerCase();
    final List<StockItem> visible = rows.where((StockItem row) {
      final bool filterMatch = switch (_filter) {
        StockCountFilter.all => true,
        StockCountFilter.low => row.needsReorder,
        StockCountFilter.stale => !counted(row),
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
          if (banner != null) ...<Widget>[
            _ListBannerView(banner: banner, copy: copy),
            const SizedBox(height: TpSpace.sm),
          ],
          // Equal-height tiles: a label that wraps (e.g. "Need reorder") must
          // not push its tile out of line with the others.
          // Summary tiles hold a number and a short label: text is capped at
          // 1.5x here so "Need reorder" is not cut to "Need reo..." at 2x;
          // the list below follows the full setting.
          MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.5,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Expanded(
                    child: _Metric(value: rows.length, label: copy('items')),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(child: _Metric(value: low, label: copy('reorder'))),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: _Metric(value: stale, label: copy('notToday')),
                  ),
                ],
              ),
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
          // Chips, not a segmented bar: at large text each label wraps
          // inside its own chip instead of being clipped by the bar.
          Wrap(
            key: const Key('stock.filters'),
            spacing: TpSpace.xs,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              for (final (StockCountFilter f, String label)
                  in <(StockCountFilter, String)>[
                (StockCountFilter.all, copy('all')),
                (StockCountFilter.low, copy('low')),
                (StockCountFilter.stale, copy('stale')),
              ])
                ChoiceChip(
                  key: Key('stock.filter.${f.name}'),
                  label: Text(label),
                  selected: _filter == f,
                  onSelected: (_) => setState(() => _filter = f),
                ),
            ],
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
            // One compact line per item (owner, 2026-11-27): thumbnail, name
            // and brand / bin, quantity and a status dot. Counting, genuine,
            // SKU, bins and part numbers are on the item card a tap away.
            TpCard(
              key: const Key('stock.list'),
              padding: EdgeInsets.zero,
              child: Column(
                children: <Widget>[
                  for (int i = 0; i < visible.length; i++) ...<Widget>[
                    if (i > 0) const Divider(height: 1),
                    _StockRow(
                      item: visible[i],
                      copy: copy,
                      countedToday: counted(visible[i]),
                      facesKey: facesKey,
                      localGenuine: _genuine[visible[i].id],
                      onOpen: () => unawaited(
                        _open(visible[i], copy: copy, canAdjust: canAdjust),
                      ),
                      onQuickMatches: (StockGenuine g) => unawaited(
                        _quickMatches(
                          visible[i],
                          copy,
                          g,
                          canAdjust: canAdjust,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
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

  /// Long-press "Matches" on a row: records that the shelf matches the
  /// system for this line, through the same recorder and offline outbox as
  /// the card. The count is held on the phone for the snackbar's 5 seconds
  /// so Undo truly removes it (nothing was sent); then it is sent. When the
  /// line still needs a decision first (genuine status unchecked, or an
  /// approver who posts differences) it opens the card instead.
  Future<void> _quickMatches(
    StockItem item,
    StockCountCopy copy,
    StockGenuine genuine, {
    required bool canAdjust,
  }) async {
    if (canAdjust || genuine == StockGenuine.unchecked) {
      await _open(item, copy: copy, canAdjust: canAdjust);
      return;
    }
    if (_busyId != null) return;
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    void say(String m) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(m)));
    }

    final bool? mark = switch (genuine) {
      StockGenuine.genuine => true,
      StockGenuine.notGenuine => false,
      _ => null,
    };
    final StockCountRecorder recorder = ref.read(stockCountRecorderProvider);
    setState(() => _busyId = item.id);
    String id;
    try {
      id = await recorder.recordHeld(
        item: item,
        count: item.quantity,
        userId: workspace.userId,
        fallbackCountry: workspace.activeCountry,
        genuine: mark,
      );
    } on StockCountRecordFailure catch (f) {
      say(
        switch (f.problem) {
          StockCountRecordProblem.noPlace => copy('countNoPlace'),
          StockCountRecordProblem.needsConnectionForSession =>
            copy('countNeedsConnection'),
          StockCountRecordProblem.storage => copy('saveFailed'),
        },
      );
      return;
    } on SupabaseFailure catch (f) {
      say(f.error.message);
      return;
    } on Object {
      say(copy('saveFailed'));
      return;
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
    unawaited(HapticFeedback.mediumImpact());
    final CountedTodayNotifier counted =
        ref.read(stockCountedTodayProvider.notifier);
    final DateTime? before = ref.read(stockCountedTodayProvider)[item.id];
    counted.mark(item.id, DateTime.now());
    bool undone = false;
    messenger.hideCurrentSnackBar();
    final ScaffoldFeatureController<SnackBar, SnackBarClosedReason> bar =
        messenger.showSnackBar(
      SnackBar(
        key: Key('stock.quick.${item.id}'),
        duration: const Duration(seconds: 5),
        // A snackbar with an action stays until dismissed by default; this
        // one must close on its own so the count is sent.
        persist: false,
        content: Text(
          '${copy('countedItem')} ${item.description ?? copy('stockItem')}',
        ),
        action: SnackBarAction(
          key: const Key('stock.quick.undo'),
          label: copy('undo'),
          onPressed: () => undone = true,
        ),
      ),
    );
    await bar.closed;
    if (undone) {
      final bool removed = await recorder.discardHeld(workspace.userId, id);
      if (removed) counted.restore(item.id, before);
      say(removed ? copy('countUndone') : copy('undoTooLate'));
      return;
    }
    String? device;
    try {
      device = await ref.read(inventoryDeviceIdProvider.future);
    } on Object {
      device = null;
    }
    await recorder.send(
      userId: workspace.userId,
      orgId: workspace.tenantId ?? workspace.companyId,
      deviceId: device,
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

/// One stock line in the list, three short lines so the part is clear at a
/// glance: the name (at most two lines), part number and brand (else SKU /
/// ERP code), and bin and site with the genuine status. A 60dp thumbnail on
/// the left (tap = full screen photo) and the quantity with its unit and a
/// status dot on the right. About 88-104dp tall at normal text; at large
/// text it grows and the part number and bin lines wrap instead of clipping.
/// Long-press records "Matches" (see _StockCountScreenState._quickMatches).
class _StockRow extends ConsumerWidget {
  const _StockRow({
    required this.item,
    required this.copy,
    required this.countedToday,
    required this.facesKey,
    required this.localGenuine,
    required this.onOpen,
    required this.onQuickMatches,
  });
  final StockItem item;
  final StockCountCopy copy;
  final bool countedToday;
  final String facesKey;

  /// A genuine mark stated on this phone this session (wins over the read).
  final bool? localGenuine;
  final VoidCallback onOpen;
  final ValueChanged<StockGenuine> onQuickMatches;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String status = stockStatus(
      item.quantity,
      item.minimum,
      item.critical,
    );
    final StockItemFace? face = stockItemFace(ref, item, facesKey: facesKey);
    final StockGenuine genuine = localGenuine != null
        ? stockGenuineFor(mark: localGenuine)
        : (face?.genuineFor(item.id) ?? StockGenuine.unchecked);
    // Line 2: the part number and its brand; else the SKU / ERP code with
    // the item brand.
    final String? number = face?.partNumber ?? item.itemCode;
    final String? brand = face?.partBrand ?? face?.brand;
    final String line2 = <String>[
      if ((number ?? '').isNotEmpty) number!,
      if ((brand ?? '').isNotEmpty) brand!,
    ].join(' · ');
    // Line 3: where it is.
    final String line3 = <String>[
      if ((item.locationCode ?? '').isNotEmpty)
        '${copy('bin')} ${item.locationCode}',
      if ((item.site ?? '').isNotEmpty) item.site!,
    ].join(' · ');
    final (TpStatus chipStatus, String chipLabel) = switch (genuine) {
      StockGenuine.genuine => (TpStatus.ok, copy('genuine')),
      StockGenuine.notGenuine => (TpStatus.critical, copy('notGenuine')),
      StockGenuine.aftermarket => (TpStatus.warning, copy('aftermarket')),
      StockGenuine.unchecked => (TpStatus.unknown, copy('unchecked')),
    };
    // The dot says what needs attention: stock level first, then whether it
    // was counted today. A fine line counted today has a quiet green dot.
    final (Color dot, bool hollow, String dotLabel) = switch (status) {
      'Critical' => (palette.critical.base, false, copy('Critical')),
      'Low' => (palette.warning.base, false, copy('Low')),
      _ when !countedToday => (palette.textSecondary, true, copy('stale')),
      _ => (palette.ok.base, false, copy('countedToday')),
    };
    final TextStyle? muted =
        text.bodySmall?.copyWith(color: palette.textSecondary);
    final String name = item.description ?? copy('stockItem');
    // At normal text the part and place lines stay one line each (ellipsis);
    // at large text they wrap, so nothing is clipped.
    final bool large = MediaQuery.textScalerOf(context).scale(14) > 14 * 1.3;
    // The chip is a short label in a narrow column: capped at 1.5x so the
    // whole word fits instead of ending in an ellipsis at very large text.
    final Widget chip = MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.5,
      child: TpStatusChip(
        key: Key('stock.genuineChip.${item.id}'),
        status: chipStatus,
        label: chipLabel,
        isCompact: true,
      ),
    );
    final Widget? whereText = line3.isEmpty
        ? null
        : Text(
            line3,
            key: Key('stock.where.${item.id}'),
            style: muted,
            maxLines: large ? null : 1,
            overflow: large ? null : TextOverflow.ellipsis,
          );
    return Semantics(
      button: true,
      label: <String>[
        name,
        if (line2.isNotEmpty) line2,
        if (line3.isNotEmpty) line3,
        chipLabel,
        '${item.quantity} ${item.uom ?? ''} ${copy('onHand')}'.trim(),
        dotLabel,
      ].join(', '),
      customSemanticsActions: <CustomSemanticsAction, VoidCallback>{
        CustomSemanticsAction(label: copy('markMatches')): () =>
            onQuickMatches(genuine),
      },
      excludeSemantics: true,
      child: InkWell(
        key: Key('stock.item.${item.id}'),
        onTap: onOpen,
        onLongPress: () => onQuickMatches(genuine),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.sm,
            vertical: TpSpace.sm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              StockItemThumb(item: item, facesKey: facesKey, size: 60),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      name,
                      key: Key('stock.name.${item.id}'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                        height: 1.2,
                      ),
                    ),
                    if (line2.isNotEmpty)
                      Text(
                        line2,
                        key: Key('stock.part.${item.id}'),
                        style: muted,
                        maxLines: large ? null : 1,
                        overflow: large ? null : TextOverflow.ellipsis,
                      ),
                    const SizedBox(height: 2),
                    // Place and genuine chip share a line when they fit;
                    // otherwise the chip moves under the place (never
                    // clipped, never overflowing).
                    LayoutBuilder(
                      builder: (BuildContext context, BoxConstraints box) =>
                          Wrap(
                        spacing: TpSpace.xs,
                        runSpacing: 2,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          if (whereText != null)
                            ConstrainedBox(
                              constraints:
                                  BoxConstraints(maxWidth: box.maxWidth),
                              child: whereText,
                            ),
                          chip,
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text.rich(
                    TextSpan(
                      children: <InlineSpan>[
                        TextSpan(
                          text: '${item.quantity}',
                          style: text.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w800,
                            fontFeatures: const <FontFeature>[
                              FontFeature.tabularFigures(),
                            ],
                          ),
                        ),
                        if ((item.uom ?? '').isNotEmpty)
                          TextSpan(text: ' ${item.uom}', style: muted),
                      ],
                    ),
                    key: Key('stock.qty.${item.id}'),
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Container(
                    key: Key('stock.dot.${item.id}'),
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: hollow ? null : dot,
                      border: hollow ? Border.all(color: dot, width: 2) : null,
                    ),
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

/// The count actions for one line, shown at the top of its item card:
/// on hand and status, Matches / Doesn't match with the genuine mark (or
/// +/- and Count for an approver), and issue / return to a job card. Holds
/// its own busy and genuine state because it lives on the pushed card route;
/// the work itself is done by Stock Count (the same recorder and dialogs).
class _CountPanel extends ConsumerStatefulWidget {
  const _CountPanel({
    required this.item,
    required this.canAdjust,
    required this.initialGenuine,
    required this.onGenuine,
    required this.onMatches,
    required this.onCount,
    required this.onAdjust,
    required this.onMove,
  });
  final StockItem item;
  final bool canAdjust;
  final bool? initialGenuine;
  final ValueChanged<bool?> onGenuine;
  final Future<void> Function() onMatches;
  final Future<void> Function() onCount;
  final Future<void> Function(int delta) onAdjust;
  final Future<void> Function(JobCardMove move) onMove;

  @override
  ConsumerState<_CountPanel> createState() => _CountPanelState();
}

class _CountPanelState extends ConsumerState<_CountPanel> {
  late bool? _genuine = widget.initialGenuine;
  bool _busy = false;
  bool _matching = false;

  Future<void> _run(
    Future<void> Function() action, {
    bool matching = false,
  }) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _matching = matching;
    });
    try {
      await action();
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _matching = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final StockCountCopy copy = StockCountCopy.of(context);
    final InventoryCopy inventoryCopy = InventoryCopy.of(context);
    final StockItem item = widget.item;
    final bool counted = stockLineCountedToday(
      item,
      DateTime.now(),
      ref.watch(stockCountedTodayProvider),
    );
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
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      key: Key('stock.panel.${item.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            item.description ?? copy('stockItem'),
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              if (widget.canAdjust) ...<Widget>[
                IconButton(
                  key: Key('stock.decrease.${item.id}'),
                  tooltip: copy('decrease'),
                  onPressed: _busy || item.quantity <= 0
                      ? null
                      : () => _run(() => widget.onAdjust(-1)),
                  icon: const Icon(Icons.remove_circle_outline_rounded),
                ),
              ],
              Text(
                '${item.quantity}',
                style:
                    text.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
              ),
              if (widget.canAdjust)
                IconButton(
                  key: Key('stock.increase.${item.id}'),
                  tooltip: copy('increase'),
                  onPressed:
                      _busy ? null : () => _run(() => widget.onAdjust(1)),
                  icon: const Icon(Icons.add_circle_outline_rounded),
                ),
              Text(copy('onHand')),
              TpStatusChip(status: tpStatus, label: copy(status)),
              if (counted)
                TpStatusChip(
                  key: Key('stock.countedToday.${item.id}'),
                  status: TpStatus.info,
                  label: copy('countedToday'),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          if (widget.canAdjust)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: OutlinedButton.icon(
                key: Key('stock.count.${item.id}'),
                onPressed: _busy ? null : () => _run(widget.onCount),
                icon: const Icon(Icons.edit_note_rounded),
                label: Text(copy('count')),
              ),
            )
          else ...<Widget>[
            _GenuineChoice(
              keyPrefix: 'stock.genuine.${item.id}',
              copy: copy,
              value: _genuine,
              onChanged: _busy
                  ? null
                  : (bool? v) {
                      setState(() => _genuine = v);
                      widget.onGenuine(v);
                    },
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              alignment: WrapAlignment.end,
              children: <Widget>[
                FilledButton.tonalIcon(
                  key: Key('stock.matches.${item.id}'),
                  onPressed: _busy
                      ? null
                      : () => _run(widget.onMatches, matching: true),
                  icon: _matching
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
                  onPressed: _busy ? null : () => _run(widget.onCount),
                  icon: const Icon(Icons.edit_note_rounded),
                  label: Text(copy('notMatch')),
                ),
              ],
            ),
          ],
          const Divider(height: TpSpace.lg),
          Wrap(
            spacing: TpSpace.sm,
            children: <Widget>[
              TextButton.icon(
                key: Key('stock.issue.${item.id}'),
                onPressed: _busy
                    ? null
                    : () => unawaited(widget.onMove(JobCardMove.issue)),
                icon: const Icon(Icons.outbox_outlined),
                label: Text(inventoryCopy('jc_issueTitle')),
              ),
              TextButton.icon(
                key: Key('stock.return.${item.id}'),
                onPressed: _busy
                    ? null
                    : () => unawaited(widget.onMove(JobCardMove.issueReturn)),
                icon: const Icon(Icons.move_to_inbox_outlined),
                label: Text(inventoryCopy('jc_returnTitle')),
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

/// Why the list on screen is the last loaded one.
enum _ListBanner { offline, refreshFailed, refreshing }

class _ListBannerView extends StatelessWidget {
  const _ListBannerView({required this.banner, required this.copy});
  final _ListBanner banner;
  final StockCountCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final (IconData icon, String text, TpStatusColors tone) = switch (banner) {
      _ListBanner.offline => (
          Icons.cloud_off_rounded,
          copy('offlineShowingLast'),
          palette.warning,
        ),
      _ListBanner.refreshFailed => (
          Icons.error_outline_rounded,
          copy('refreshFailedShowingLast'),
          palette.warning,
        ),
      _ListBanner.refreshing => (
          Icons.sync_rounded,
          copy('refreshing'),
          palette.info,
        ),
    };
    return Semantics(
      liveRegion: true,
      child: DecoratedBox(
        key: Key('stock.banner.${banner.name}'),
        decoration: BoxDecoration(
          color: tone.soft,
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.sm),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 20, color: tone.onSoft),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(text, style: TextStyle(color: tone.onSoft)),
              ),
              if (banner == _ListBanner.refreshing)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
