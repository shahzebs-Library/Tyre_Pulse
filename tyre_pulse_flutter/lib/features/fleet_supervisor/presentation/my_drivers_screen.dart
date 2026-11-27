/// My drivers: the Fleet Supervisor's team and the drivers they may add.
///
/// Each row shows the vehicle the driver has now, open charges and fines, and
/// the vehicle's last odometer reading. A row opens the driver, where the
/// supervisor assigns or changes the vehicle, issues a charge or a traffic
/// fine, starts a handover, or removes the driver from the team.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart'
    show TpIdentifierText;
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/fleet_supervisor/domain/fleet_team.dart';
import 'package:tyre_pulse/features/fleet_supervisor/fleet_supervisor_providers.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_driver_detail_screen.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_copy.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_ui.dart';

abstract final class MyDriversKeys {
  static const Key scopeMine = Key('fleetSup.scope.mine');
  static const Key scopeAvailable = Key('fleetSup.scope.available');
  static const Key search = Key('fleetSup.search');
  static const Key loadMore = Key('fleetSup.loadMore');
  static Key row(String id) => Key('fleetSup.row.$id');
}

class MyDriversScreen extends ConsumerStatefulWidget {
  const MyDriversScreen({super.key});

  @override
  ConsumerState<MyDriversScreen> createState() => _MyDriversScreenState();
}

class _MyDriversScreenState extends ConsumerState<MyDriversScreen> {
  FleetTeamView _view = FleetTeamView.mine;
  final TextEditingController _search = TextEditingController();
  Timer? _debounce;
  List<FleetTeamDriver> _rows = const <FleetTeamDriver>[];
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;
  Object? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    final int gen = more ? _generation : ++_generation;
    setState(() {
      if (more) {
        _loadingMore = true;
      } else {
        _loading = true;
        _error = null;
      }
    });
    try {
      final FleetTeamPage page =
          await ref.read(fleetTeamRepositoryProvider).drivers(
                view: _view,
                search: _search.text,
                offset: more ? _rows.length : 0,
              );
      if (!mounted || gen != _generation) return;
      setState(() {
        _rows = more ? <FleetTeamDriver>[..._rows, ...page.rows] : page.rows;
        _hasMore = page.hasMore;
        _loading = false;
        _loadingMore = false;
      });
    } on Object catch (error) {
      if (!mounted || gen != _generation) return;
      setState(() {
        _loading = false;
        _loadingMore = false;
        if (more) {
          fleetSnack(
            context,
            fleetErrorText(FleetSupervisorCopy.of(context), error),
          );
        } else {
          _error = error;
        }
      });
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) unawaited(_load());
    });
  }

  Future<void> _open(FleetTeamDriver d) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => FleetDriverDetailScreen(
          driver: d,
          onTeam: _view == FleetTeamView.mine,
        ),
      ),
    );
    if (mounted) unawaited(_load());
  }

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    return TpScaffold(
      appBar: TpAppBar(title: copy('title')),
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
              child: TpSegmented<FleetTeamView>(
                expanded: true,
                value: _view,
                options: <TpSegmentedOption<FleetTeamView>>[
                  TpSegmentedOption<FleetTeamView>(
                    value: FleetTeamView.mine,
                    label: copy('tabMine'),
                  ),
                  TpSegmentedOption<FleetTeamView>(
                    value: FleetTeamView.available,
                    label: copy('tabAvailable'),
                  ),
                ],
                onChanged: (FleetTeamView v) {
                  setState(() => _view = v);
                  unawaited(_load());
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                TpSpace.lg,
                0,
                TpSpace.lg,
                TpSpace.sm,
              ),
              child: TpSearchField(
                key: MyDriversKeys.search,
                controller: _search,
                hint: copy('search'),
                onChanged: _onSearch,
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _load,
                child: _body(copy),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body(FleetSupervisorCopy copy) {
    if (_loading) return const TpLoadingState();
    final Object? error = _error;
    if (error != null) {
      if (error is AppError && error.kind == AppErrorKind.authorization) {
        return TpPermissionDeniedState(reason: copy('noAccess'));
      }
      return TpErrorState(error: fleetAsAppError(copy, error), onRetry: _load);
    }
    if (_rows.isEmpty) {
      final bool searching = _search.text.trim().isNotEmpty;
      return ListView(
        children: <Widget>[
          const SizedBox(height: TpSpace.huge),
          TpEmptyState(
            icon: Icons.groups_outlined,
            title: searching
                ? copy('emptySearch')
                : copy(
                    _view == FleetTeamView.mine
                        ? 'emptyMineTitle'
                        : 'emptyAvailableTitle',
                  ),
            message: searching
                ? null
                : copy(
                    _view == FleetTeamView.mine
                        ? 'emptyMineMessage'
                        : 'emptyAvailableMessage',
                  ),
            actionLabel: _view == FleetTeamView.mine && !searching
                ? copy('tabAvailable')
                : null,
            onAction: _view == FleetTeamView.mine && !searching
                ? () {
                    setState(() => _view = FleetTeamView.available);
                    unawaited(_load());
                  }
                : null,
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
      itemCount: _rows.length + (_hasMore ? 1 : 0),
      separatorBuilder: (_, __) => const SizedBox(height: TpSpace.sm),
      itemBuilder: (BuildContext context, int i) {
        if (i == _rows.length) {
          return TpButton.secondary(
            key: MyDriversKeys.loadMore,
            label: copy('loadMore'),
            isBusy: _loadingMore,
            onPressed: () => unawaited(_load(more: true)),
          );
        }
        final FleetTeamDriver d = _rows[i];
        return FleetDriverRow(
          key: MyDriversKeys.row(d.id),
          driver: d,
          onTap: () => unawaited(_open(d)),
        );
      },
    );
  }
}

/// One compact driver row. Used by the list and as the detail header.
class FleetDriverRow extends StatelessWidget {
  const FleetDriverRow({required this.driver, this.onTap, super.key});

  final FleetTeamDriver driver;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TextStyle? muted = text.bodySmall?.copyWith(color: palette.textMuted);
    return TpCard(
      onTap: onTap,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  driver.name,
                  style: text.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              if (driver.hasVehicle)
                TpStatusChip(
                  status: TpStatus.info,
                  icon: Icons.local_shipping_outlined,
                  label: driver.assetNo,
                  isCompact: true,
                )
              else
                TpStatusChip(
                  status: TpStatus.neutral,
                  label: copy('noVehicle'),
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
              TpIdentifierText(driver.employeeId, style: muted),
              if (driver.site != null) Text(driver.site!, style: muted),
              if (driver.registrationNo != null)
                TpIdentifierText(driver.registrationNo!, style: muted),
              if (!driver.loginLinked)
                Text(copy('loginNotLinked'), style: muted),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              if (driver.openCharges > 0)
                TpStatusChip(
                  status: TpStatus.warning,
                  icon: Icons.receipt_long_outlined,
                  label: copy.fill(
                    'openCharges',
                    <String, String>{'n': '${driver.openCharges}'},
                  ),
                  isCompact: true,
                ),
              if (driver.openFines > 0)
                TpStatusChip(
                  status: TpStatus.warning,
                  icon: Icons.local_police_outlined,
                  label: copy.fill(
                    'openFines',
                    <String, String>{'n': '${driver.openFines}'},
                  ),
                  isCompact: true,
                ),
              if (driver.hasVehicle)
                Text(
                  driver.lastKm == null
                      ? copy('noKm')
                      : copy.fill(
                          driver.lastKmDate == null ? 'lastKmOnly' : 'lastKm',
                          <String, String>{
                              'km': fleetKm(driver.lastKm!),
                              'date': fleetDate(driver.lastKmDate),
                            }),
                  style: muted,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
