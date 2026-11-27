/// One driver on (or joining) the supervisor's team.
///
/// Actions: add to team, assign / change / take back the vehicle, issue a
/// charge, record a traffic fine, start a vehicle handover, remove from team.
/// Every change closes the open assignment row and opens a new one on the
/// server, so the history below is never rewritten.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart'
    show TpIdentifierText;
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/fleet_supervisor/domain/fleet_team.dart';
import 'package:tyre_pulse/features/fleet_supervisor/fleet_supervisor_providers.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_copy.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_ui.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/issue_charge_screen.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/my_drivers_screen.dart';
import 'package:uuid/uuid.dart';

abstract final class FleetDriverKeys {
  static const Key take = Key('fleetSup.take');
  static const Key assign = Key('fleetSup.assign');
  static const Key unassign = Key('fleetSup.unassign');
  static const Key charge = Key('fleetSup.charge');
  static const Key fine = Key('fleetSup.fine');
  static const Key handover = Key('fleetSup.handover');
  static const Key release = Key('fleetSup.release');
  static Key vehicle(String id) => Key('fleetSup.vehicle.$id');
}

class FleetDriverDetailScreen extends ConsumerStatefulWidget {
  const FleetDriverDetailScreen({
    required this.driver,
    required this.onTeam,
    super.key,
  });

  final FleetTeamDriver driver;
  final bool onTeam;

  @override
  ConsumerState<FleetDriverDetailScreen> createState() =>
      _FleetDriverDetailScreenState();
}

class _FleetDriverDetailScreenState
    extends ConsumerState<FleetDriverDetailScreen> {
  static const Uuid _uuid = Uuid();
  late FleetTeamDriver _driver = widget.driver;
  late bool _onTeam = widget.onTeam;
  List<FleetAssignment>? _history;
  Object? _historyError;
  String? _busy;

  @override
  void initState() {
    super.initState();
    unawaited(_loadHistory());
  }

  Future<void> _loadHistory() async {
    setState(() => _historyError = null);
    try {
      final List<FleetAssignment> rows =
          await ref.read(fleetTeamRepositoryProvider).history(_driver.id);
      if (mounted) setState(() => _history = rows);
    } on Object catch (e) {
      if (mounted) setState(() => _historyError = e);
    }
  }

  /// Sends one team action; returns true when the server confirmed it.
  Future<bool> _send(
    String action,
    Map<String, Object?> payload, {
    FleetVehicleOption? vehicle,
  }) async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    setState(() => _busy = action);
    try {
      FleetCommandOutcome outcome = await ref
          .read(fleetTeamRepositoryProvider)
          .command(action, payload, _uuid.v4());
      if (outcome is FleetVehicleConflict && mounted) {
        final bool move = await TpDialog.confirm(
          context: context,
          title: copy('conflictTitle'),
          message: copy.fill('conflictMessage', <String, String>{
            'asset': outcome.assetNo ?? vehicle?.assetNo ?? '',
            'name': outcome.driverName,
          }),
          confirmLabel: copy('conflictConfirm'),
          cancelLabel: copy('cancel'),
        );
        if (!move || !mounted) return false;
        outcome = await ref.read(fleetTeamRepositoryProvider).command(
              action,
              <String, Object?>{
                ...payload,
                'move_from_driver': outcome.driverId,
              },
              _uuid.v4(),
            );
      }
      if (outcome is! FleetCommandDone) return false;
      if (!mounted) return true;
      setState(() {
        switch (action) {
          case FleetTeamAction.take:
            _onTeam = true;
          case FleetTeamAction.release:
            _onTeam = false;
          case FleetTeamAction.assignVehicle:
            _driver = _driver.withVehicle(vehicle);
          case FleetTeamAction.unassignVehicle:
            _driver = _driver.withVehicle(null);
        }
      });
      fleetSnack(context, copy('saved'));
      unawaited(_loadHistory());
      return true;
    } on Object catch (e) {
      if (mounted) fleetSnack(context, fleetErrorText(copy, e));
      return false;
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _take() async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final String? reason = await askFleetReason(
      context,
      title: copy.fill('takeTitle', <String, String>{'name': _driver.name}),
      confirmLabel: copy('takeDriver'),
    );
    if (reason == null || !mounted) return;
    await _send(
      FleetTeamAction.take,
      <String, Object?>{'driver_id': _driver.id, 'reason': reason},
    );
  }

  Future<void> _assign() async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final FleetVehicleOption? picked =
        await TpBottomSheet.show<FleetVehicleOption>(
      context: context,
      title: copy('chooseVehicle'),
      builder: (_) => FleetVehiclePicker(country: _driver.country),
    );
    if (picked == null || !mounted) return;
    final String? reason = await askFleetReason(
      context,
      title: '${copy('assignVehicle')}: ${picked.assetNo}',
    );
    if (reason == null || !mounted) return;
    await _send(
      FleetTeamAction.assignVehicle,
      <String, Object?>{
        'driver_id': _driver.id,
        'vehicle_id': picked.id,
        'reason': reason,
      },
      vehicle: picked,
    );
  }

  Future<void> _unassign() async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final String? reason = await askFleetReason(
      context,
      title: copy.fill('unassignTitle', <String, String>{
        'asset': _driver.assetNo ?? '',
        'name': _driver.name,
      }),
      confirmLabel: copy('unassignVehicle'),
      destructive: true,
    );
    if (reason == null || !mounted) return;
    await _send(
      FleetTeamAction.unassignVehicle,
      <String, Object?>{'driver_id': _driver.id, 'reason': reason},
    );
  }

  Future<void> _release() async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final String? reason = await askFleetReason(
      context,
      title: copy.fill('releaseTitle', <String, String>{'name': _driver.name}),
      message: copy('releaseMessage'),
      confirmLabel: copy('releaseDriver'),
      destructive: true,
    );
    if (reason == null || !mounted) return;
    await _send(
      FleetTeamAction.release,
      <String, Object?>{'driver_id': _driver.id, 'reason': reason},
    );
  }

  Future<void> _issue(FleetIssueMode mode) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => IssueChargeScreen(driver: _driver, mode: mode),
      ),
    );
  }

  void _handover() {
    unawaited(
      context.push(
        NewHandoverRoute(
          assetNo: _driver.assetNo == null ? null : AssetNo(_driver.assetNo!),
        ).location,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpScaffold(
      appBar: TpAppBar(
        title: _driver.name,
        subtitle:
            copy.fill('employeeId', <String, String>{'id': _driver.employeeId}),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.huge,
          ),
          children: <Widget>[
            FleetDriverRow(driver: _driver),
            const SizedBox(height: TpSpace.lg),
            if (!_onTeam) ...<Widget>[
              Text(copy('notOnTeam'), style: text.bodyMedium),
              const SizedBox(height: TpSpace.sm),
              TpButton.primary(
                key: FleetDriverKeys.take,
                label: copy('takeDriver'),
                icon: Icons.group_add_outlined,
                isBusy: _busy == FleetTeamAction.take,
                isFullWidth: true,
                onPressed: _busy == null ? () => unawaited(_take()) : null,
              ),
            ] else ...<Widget>[
              TpButton.primary(
                key: FleetDriverKeys.assign,
                label: copy(
                  _driver.hasVehicle ? 'reassignVehicle' : 'assignVehicle',
                ),
                icon: Icons.local_shipping_outlined,
                isBusy: _busy == FleetTeamAction.assignVehicle,
                isFullWidth: true,
                onPressed: _busy == null ? () => unawaited(_assign()) : null,
              ),
              const SizedBox(height: TpSpace.sm),
              TpButton.secondary(
                key: FleetDriverKeys.charge,
                label: copy('issueCharge'),
                icon: Icons.receipt_long_outlined,
                isFullWidth: true,
                onPressed: _busy == null
                    ? () => unawaited(_issue(FleetIssueMode.charge))
                    : null,
              ),
              const SizedBox(height: TpSpace.sm),
              TpButton.secondary(
                key: FleetDriverKeys.fine,
                label: copy('issueFine'),
                icon: Icons.local_police_outlined,
                isFullWidth: true,
                onPressed: _busy == null
                    ? () => unawaited(_issue(FleetIssueMode.fine))
                    : null,
              ),
              const SizedBox(height: TpSpace.sm),
              TpButton.secondary(
                key: FleetDriverKeys.handover,
                label: copy('handOver'),
                icon: Icons.swap_horiz,
                isFullWidth: true,
                onPressed: _busy == null ? _handover : null,
              ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
                child: Text(
                  copy('handoverHint'),
                  style: text.bodySmall
                      ?.copyWith(color: TpPalette.of(context).textMuted),
                ),
              ),
              if (_driver.hasVehicle)
                TpButton.text(
                  key: FleetDriverKeys.unassign,
                  label: copy('unassignVehicle'),
                  icon: Icons.assignment_return_outlined,
                  isBusy: _busy == FleetTeamAction.unassignVehicle,
                  isFullWidth: true,
                  onPressed:
                      _busy == null ? () => unawaited(_unassign()) : null,
                ),
              TpButton.text(
                key: FleetDriverKeys.release,
                label: copy('releaseDriver'),
                icon: Icons.person_remove_outlined,
                isBusy: _busy == FleetTeamAction.release,
                isFullWidth: true,
                onPressed: _busy == null ? () => unawaited(_release()) : null,
              ),
            ],
            const SizedBox(height: TpSpace.lg),
            Text(copy('history'), style: text.titleMedium),
            const SizedBox(height: TpSpace.sm),
            _historySection(copy),
          ],
        ),
      ),
    );
  }

  Widget _historySection(FleetSupervisorCopy copy) {
    final Object? err = _historyError;
    if (err != null) {
      return TpErrorState(
        error: fleetAsAppError(copy, err),
        onRetry: _loadHistory,
      );
    }
    final List<FleetAssignment>? rows = _history;
    if (rows == null) {
      return const Padding(
        padding: EdgeInsets.all(TpSpace.lg),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (rows.isEmpty) {
      return Text(
        copy('historyEmpty'),
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }
    return Column(
      children: <Widget>[
        for (final FleetAssignment a in rows) ...<Widget>[
          _HistoryRow(a: a),
          const SizedBox(height: TpSpace.sm),
        ],
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.a});
  final FleetAssignment a;

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TextStyle? muted =
        text.bodySmall?.copyWith(color: TpPalette.of(context).textMuted);
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              TpStatusChip(
                status: a.isCurrent ? TpStatus.ok : TpStatus.neutral,
                label: copy(a.isCurrent ? 'current' : 'previous'),
                isCompact: true,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: a.assetNo == null
                    ? Text(copy('noVehicle'), style: text.titleSmall)
                    : TpIdentifierText(a.assetNo!, style: text.titleSmall),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            a.isCurrent
                ? copy.fill(
                    'since',
                    <String, String>{'date': fleetDate(a.startsAt)},
                  )
                : copy.fill('fromTo', <String, String>{
                    'from': fleetDate(a.startsAt),
                    'to': fleetDate(a.endsAt),
                  }),
            style: muted,
          ),
          if (a.supervisorName != null)
            Text(
              copy.fill(
                'supervisor',
                <String, String>{'name': a.supervisorName!},
              ),
              style: muted,
            ),
          if (a.reason != null) Text(a.reason!, style: text.bodySmall),
          if (a.assignedByName != null)
            Text(
              copy.fill(
                'assignedBy',
                <String, String>{'name': a.assignedByName!},
              ),
              style: muted,
            ),
        ],
      ),
    );
  }
}

/// Vehicle search inside a sheet. Pops the chosen vehicle.
class FleetVehiclePicker extends ConsumerStatefulWidget {
  const FleetVehiclePicker({required this.country, super.key});
  final String? country;

  @override
  ConsumerState<FleetVehiclePicker> createState() => _FleetVehiclePickerState();
}

class _FleetVehiclePickerState extends ConsumerState<FleetVehiclePicker> {
  final TextEditingController _q = TextEditingController();
  Timer? _debounce;
  List<FleetVehicleOption>? _rows;
  Object? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final List<FleetVehicleOption> rows = await ref
          .read(fleetTeamRepositoryProvider)
          .vehicles(country: widget.country, search: _q.text);
      if (mounted) setState(() => _rows = rows);
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final List<FleetVehicleOption>? rows = _rows;
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TpSearchField(
            controller: _q,
            hint: copy('vehicleSearch'),
            onChanged: (_) {
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 300), () {
                if (mounted) unawaited(_load());
              });
            },
          ),
          const SizedBox(height: TpSpace.sm),
          Expanded(
            child: _error != null
                ? TpErrorState(
                    error: fleetAsAppError(copy, _error!),
                    onRetry: _load,
                  )
                : rows == null
                    ? const TpLoadingState()
                    : rows.isEmpty
                        ? TpEmptyState(
                            icon: Icons.local_shipping_outlined,
                            title: copy('noVehicles'),
                          )
                        : ListView.separated(
                            itemCount: rows.length,
                            separatorBuilder: (_, __) => Divider(
                              height: 1,
                              color: palette.border,
                            ),
                            itemBuilder: (BuildContext c, int i) {
                              final FleetVehicleOption v = rows[i];
                              return ListTile(
                                key: FleetDriverKeys.vehicle(v.id),
                                minVerticalPadding: TpSpace.sm,
                                leading:
                                    const Icon(Icons.local_shipping_outlined),
                                title: TpIdentifierText(v.assetNo),
                                subtitle: Text(
                                  <String>[
                                    if (v.registrationNo != null)
                                      v.registrationNo!,
                                    if (v.vehicleType != null) v.vehicleType!,
                                    if (v.site != null) v.site!,
                                  ].join('  '),
                                ),
                                onTap: () => Navigator.of(context).pop(v),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }
}
