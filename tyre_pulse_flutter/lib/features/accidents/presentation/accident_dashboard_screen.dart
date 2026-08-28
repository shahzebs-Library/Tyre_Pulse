library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

enum _StatusFilter { all, open, closed }

class AccidentDashboardScreen extends ConsumerStatefulWidget {
  const AccidentDashboardScreen({required this.route, super.key});
  final AccidentDashboardRoute route;

  @override
  ConsumerState<AccidentDashboardScreen> createState() =>
      _AccidentDashboardScreenState();
}

class _AccidentDashboardScreenState
    extends ConsumerState<AccidentDashboardScreen> {
  static const int _pageSize = 40;
  final TextEditingController _search = TextEditingController();
  final List<AccidentRecord> _items = <AccidentRecord>[];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  bool _mine = false;
  _StatusFilter _status = _StatusFilter.all;
  AppError? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load(reset: true));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final workspace = ref.read(workspaceContextProvider);
      final AccidentListPage page =
          await ref.read(accidentRepositoryProvider).list(
                offset: reset ? 0 : _items.length,
                pageSize: _pageSize,
                country: workspace?.activeCountry,
                reporterId: _mine ? workspace?.userId : null,
              );
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(page.items);
        _hasMore = page.hasMore;
        _loading = false;
        _loadingMore = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = accidentAppError(error, AccidentCopy.of(context));
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  List<AccidentRecord> get _shown {
    final String query = _search.text.trim().toLowerCase();
    return _items.where((AccidentRecord item) {
      final bool closed = item.status?.toLowerCase() == 'closed' ||
          item.closureStatus?.toLowerCase() == 'closed';
      if (_status == _StatusFilter.open && closed) return false;
      if (_status == _StatusFilter.closed && !closed) return false;
      if (query.isEmpty) return true;
      return <String?>[
        item.assetNo,
        item.site,
        item.referenceNo,
        item.location,
        item.accidentType,
        item.reporterName,
      ].any((String? value) => value?.toLowerCase().contains(query) ?? false);
    }).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final AccidentCopy copy = AccidentCopy.of(context);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('dashboardTitle'),
        subtitle: copy('dashboardSubtitle'),
        actions: <Widget>[
          IconButton(
            tooltip: copy('reportAction'),
            icon: const Icon(Icons.add_alert_outlined),
            onPressed: () => context.push(const AccidentReportRoute().location),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push(const AccidentReportRoute().location),
        icon: const Icon(Icons.add_a_photo_outlined),
        label: Text(copy('reportShort')),
      ),
      body: _body(copy),
    );
  }

  Widget _body(AccidentCopy copy) {
    if (_loading) {
      return TpLoadingState(message: copy('loadingRegister'));
    }
    if (_error != null && _items.isEmpty) {
      return TpErrorState(error: _error!, onRetry: () => _load(reset: true));
    }
    final List<AccidentRecord> shown = _shown;
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView(
        padding:
            const EdgeInsets.fromLTRB(TpSpace.lg, TpSpace.lg, TpSpace.lg, 96),
        children: <Widget>[
          AccidentHero(
            eyebrow: copy('dashboardEyebrow'),
            title: copy('dashboardHeroTitle'),
            message: copy('dashboardHeroMessage'),
            icon: Icons.health_and_safety_outlined,
          ),
          const SizedBox(height: TpSpace.lg),
          TpSearchField(
            controller: _search,
            hint: copy('searchHint'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: TpSpace.md),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              FilterChip(
                label: Text(copy('allCases')),
                selected: !_mine,
                onSelected: (_) {
                  setState(() => _mine = false);
                  unawaited(_load(reset: true));
                },
              ),
              FilterChip(
                label: Text(copy('reportedByMe')),
                selected: _mine,
                onSelected: (_) {
                  setState(() => _mine = true);
                  unawaited(_load(reset: true));
                },
              ),
              for (final _StatusFilter status in _StatusFilter.values)
                ChoiceChip(
                  label: Text(
                    switch (status) {
                      _StatusFilter.all => copy('anyStatus'),
                      _StatusFilter.open => copy('open'),
                      _StatusFilter.closed => copy('closed'),
                    },
                  ),
                  selected: _status == status,
                  onSelected: (_) => setState(() => _status = status),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.md),
              child: Text(_error!.message),
            ),
          if (shown.isEmpty)
            SizedBox(
              height: 360,
              child: TpEmptyState(
                icon: Icons.car_crash_outlined,
                title: copy('noMatches'),
                message: copy('noMatchesMessage'),
              ),
            )
          else
            for (final AccidentRecord item in shown) ...<Widget>[
              _AccidentCard(
                item: item,
                onTap: () => context.push(
                  AccidentDetailRoute(accidentId: AccidentId(item.id)).location,
                ),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
          if (_hasMore)
            TpButton.secondary(
              label: _loadingMore ? copy('loading') : copy('loadMore'),
              onPressed: _loadingMore ? null : () => _load(reset: false),
              isBusy: _loadingMore,
              isFullWidth: true,
            ),
        ],
      ),
    );
  }
}

class _AccidentCard extends StatelessWidget {
  const _AccidentCard({required this.item, required this.onTap});
  final AccidentRecord item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => TpCard(
        onTap: onTap,
        borderColor: Theme.of(context).colorScheme.outlineVariant,
        child: Row(
          children: <Widget>[
            Icon(
              Icons.local_shipping_outlined,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          item.assetNo,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      TpStatusChip(
                        status: accidentTone(item.severity),
                        label: humaniseAccidentToken(item.severity),
                        isCompact: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: TpSpace.xs),
                  Text('${item.reference} • ${item.site}'),
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    '${item.incidentDate} • ${humaniseAccidentToken(item.accidentType)}'
                    '${item.location == null ? '' : ' • ${item.location}'}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: TpSpace.sm),
                  TpStatusChip(
                    status: accidentTone(item.displayStatus),
                    label: humaniseAccidentToken(item.displayStatus),
                    isCompact: true,
                  ),
                ],
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            const Icon(Icons.chevron_right),
          ],
        ),
      );
}
