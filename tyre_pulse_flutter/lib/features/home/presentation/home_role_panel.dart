// The per-role Home: up to two big tiles, compact rows and chips, driven by
// one data-driven plan (`domain/home_role_plan.dart`). A `part` of
// home_screen.dart so it shares that file's tile labels and navigation
// (`_tileMeta`, `_openHomeTile`) instead of a second copy of them.
//
// Every count row is a tap target to the records it counts, and a failed
// read says "-" and "Could not check", never 0. Every entry is dropped
// unless the person can open the module it leads to.
part of 'home_screen.dart';

/// The module each "More" tile id opens, read from the one catalogue.
ModuleKey? _moduleForTile(String id) {
  for (final HomeSectionSpec section in _kHomeSections) {
    for (final HomeTileSpec tile in section.tiles) {
      if (tile.id == id) return tile.module;
    }
  }
  return null;
}

/// `184230` -> `184,230`; decimals kept as recorded.
String _groupThousands(num value) {
  final String whole = value.truncate().abs().toString();
  final StringBuffer out = StringBuffer(value < 0 ? '-' : '');
  for (int i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) out.write(',');
    out.write(whole[i]);
  }
  if (value % 1 != 0) {
    out.write(value.toString().substring(value.toString().indexOf('.')));
  }
  return out.toString();
}

/// The value text and note for a count that may still be loading or have
/// failed.
({String value, String? note}) _countState<T>(
  AppLocalizations l10n,
  AsyncValue<T>? state,
  String Function(T value) text,
) =>
    switch (state) {
      AsyncData<T>(value: final T v) => (value: text(v), note: null),
      AsyncError<T>() => (value: '-', note: l10n.homeStatUnavailableCaption),
      _ => (value: '-', note: l10n.homeStatLoadingCaption),
    };

final class _RoleBigData {
  const _RoleBigData({
    required this.id,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.value,
    this.children = const <_RoleRowData>[],
  });

  final String id;
  final IconData icon;
  final String title;
  final String? subtitle;

  /// A headline count shown at the end of the tile.
  final String? value;
  final VoidCallback? onTap;

  /// Count rows drawn INSIDE the tile (the exceptions card).
  final List<_RoleRowData> children;
}

final class _RoleRowData {
  const _RoleRowData({
    required this.id,
    required this.icon,
    required this.title,
    required this.onTap,
    this.value,
    this.note,
    this.danger = false,
  });

  final String id;
  final IconData icon;
  final String title;
  final String? value;
  final String? note;
  final bool danger;
  final VoidCallback onTap;
}

class _RoleHomePanel extends ConsumerWidget {
  const _RoleHomePanel({required this.plan, required this.onMore});

  final HomeRolePlan plan;
  final VoidCallback onMore;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    String c(String key) => _catalogLabel(l10n.homeRoleCopyCatalog, key);
    bool can(ModuleKey m) => ref.watch(canAccessModuleProvider(m));
    final DateTime now = ref.watch(homeHeaderClockProvider)();
    final bool canSign = can(ModuleKey.approvals) &&
        ref.watch(homeCanSignInspectionApprovalsProvider);
    final bool canPlan = can(ModuleKey.calendar) || can(ModuleKey.tasks);
    void openPlan() => can(ModuleKey.calendar)
        ? context.push(const CalendarRoute().location)
        : context.push(const TasksRoute().location);

    // ---- shared row builders -------------------------------------------
    _RoleRowData countRow<T>({
      required String id,
      required IconData icon,
      required String title,
      required AsyncValue<T> state,
      required String Function(T) text,
      required VoidCallback onTap,
      bool danger = false,
    }) {
      final ({String value, String? note}) s = _countState(l10n, state, text);
      return _RoleRowData(
        id: id,
        icon: icon,
        title: title,
        value: s.value,
        note: s.note,
        danger: danger,
        onTap: onTap,
      );
    }

    _RoleRowData? offRoad() => can(ModuleKey.vehicles)
        ? countRow<int>(
            id: 'offRoad',
            icon: Icons.car_crash_outlined,
            title: c('offRoad'),
            state: ref.watch(homeOffRoadCountProvider),
            text: (int v) => '$v',
            onTap: () => context.push(const VehiclesRoute().location),
          )
        : null;
    _RoleRowData? openAccidents() => can(ModuleKey.accidents)
        ? countRow<int>(
            id: 'openAccidents',
            icon: Icons.report_problem_outlined,
            title: c('openAccidents'),
            state: ref.watch(homeOpenAccidentsCountProvider),
            text: (int v) => '$v',
            onTap: () => context.go(const AccidentDashboardRoute().location),
          )
        : null;
    _RoleRowData? maintenanceDue() => can(ModuleKey.pm)
        ? countRow<int>(
            id: 'maintenanceDue',
            icon: Icons.build_circle_outlined,
            title: c('maintenanceOverdue'),
            state: ref.watch(homeMaintenanceOverdueCountProvider),
            text: (int v) => '$v',
            onTap: () =>
                context.push(const PreventiveMaintenanceRoute().location),
          )
        : null;
    String alertsText(List<TyreAlert> v) =>
        v.length >= 300 ? '${v.length}+' : '${v.length}';
    _RoleRowData? tyresAttention({String? title, String id = 'tyres'}) =>
        can(ModuleKey.alerts)
            ? countRow<List<TyreAlert>>(
                id: id,
                icon: Icons.tire_repair_outlined,
                title: title ?? c('tyresAttention'),
                state: ref.watch(tyreAlertsProvider),
                text: alertsText,
                onTap: () => context.push(const AlertsRoute().location),
              )
            : null;
    List<_RoleRowData> exceptionRows() => <_RoleRowData>[
          for (final _RoleRowData? r in <_RoleRowData?>[
            offRoad(),
            openAccidents(),
            maintenanceDue(),
            tyresAttention(),
          ])
            if (r != null) r,
        ];
    int openToday(MyWorkSnapshot v) => itemsForDay(v.items, day: now, now: now)
        .where((MyWorkItem i) => i.isOpen)
        .length;
    AsyncValue<List<ChecklistTemplateRecord>> due() =>
        ref.watch(homeChecklistsDueProvider);
    bool isWorkshopDaily(ChecklistTemplateRecord t) =>
        (t.template.name ?? '').toLowerCase().contains('workshop daily');
    String? meterSubtitle(HomeMeterToday? m) {
      if (m == null) return c('meterNotLogged');
      final DateTime? at = m.at;
      final String time = at == null
          ? ''
          : MaterialLocalizations.of(context)
              .formatTimeOfDay(TimeOfDay.fromDateTime(at));
      final num? km = m.km;
      return _joinParts(<String?>[
        c('meterLogged').replaceAll('%time%', time).trim(),
        m.assetNo,
        if (km != null) '\u2066${_groupThousands(km)} km\u2069',
      ]);
    }

    // ---- big tiles -------------------------------------------------------
    _RoleBigData? big(HomeBigTile tile) {
      switch (tile) {
        case HomeBigTile.meterToday:
          if (!can(ModuleKey.meter)) return null;
          final AsyncValue<HomeMeterToday?> m =
              ref.watch(homeMeterTodayProvider);
          return _RoleBigData(
            id: 'meterToday',
            icon: Icons.speed,
            title: c('meterTitle'),
            subtitle: switch (m) {
              AsyncData<HomeMeterToday?>(:final value) => meterSubtitle(value),
              AsyncError<HomeMeterToday?>() => l10n.homeStatUnavailableCaption,
              _ => l10n.homeStatLoadingCaption,
            },
            onTap: () => context.go(const MeterLogRoute().location),
          );
        case HomeBigTile.reportProblem:
          if (!can(ModuleKey.reportIssue)) return null;
          final String? asset =
              ref.watch(homeMyVehicleProvider).asData?.value?.assetNo;
          return _RoleBigData(
            id: 'reportProblem',
            icon: Icons.report_problem_outlined,
            title: c('problemTitle'),
            subtitle: c('problemHint'),
            onTap: () => context.push(
              ReportIssueRoute(assetNo: asset == null ? null : AssetNo(asset))
                  .location,
            ),
          );
        case HomeBigTile.exceptions:
          final List<_RoleRowData> rows = exceptionRows();
          if (rows.isEmpty) return null;
          return _RoleBigData(
            id: 'exceptions',
            icon: Icons.warning_amber_rounded,
            title: c('exceptionsTitle'),
            onTap: null,
            children: rows,
          );
        case HomeBigTile.handoverSignoff:
          if (!can(ModuleKey.handover)) return null;
          final ({String value, String? note}) s = _countState(
            l10n,
            ref.watch(homeHandoversToSignProvider),
            (HomeCount v) => v.text,
          );
          return _RoleBigData(
            id: 'handoverSignoff',
            icon: Icons.assignment_turned_in_outlined,
            title: c('handoverTitle'),
            subtitle: s.note,
            value: s.value,
            onTap: () => context.push(const HandoverRoute().location),
          );
        case HomeBigTile.reportAccident:
          if (!can(ModuleKey.reportAccident)) return null;
          final _RoleRowData? open = openAccidents();
          return _RoleBigData(
            id: 'reportAccident',
            icon: Icons.car_crash_outlined,
            title: c('reportAccident'),
            onTap: () => context.push(const AccidentReportRoute().location),
            children: <_RoleRowData>[if (open != null) open],
          );
        case HomeBigTile.approvalsWaiting:
          if (!can(ModuleKey.approvals)) return null;
          final AsyncValue<HomePendingApprovals> insp = canSign
              ? ref.watch(homePendingInspectionApprovalsProvider)
              : const AsyncData<HomePendingApprovals>(
                  HomePendingApprovals(count: 0),
                );
          final AsyncValue<int> lists =
              ref.watch(homeChecklistsAllPendingCountProvider);
          final int? a = insp.asData?.value.count;
          final int? b = lists.asData?.value;
          final bool failed = insp.hasError || lists.hasError;
          return _RoleBigData(
            id: 'approvalsWaiting',
            icon: Icons.how_to_reg_outlined,
            title: c('approvalsTitle'),
            value: a != null && b != null ? '${a + b}' : '-',
            subtitle: a != null && b != null
                ? c('approvalsSplit')
                    .replaceAll('%a%', '$a')
                    .replaceAll('%b%', '$b')
                : failed
                    ? l10n.homeStatUnavailableCaption
                    : l10n.homeStatLoadingCaption,
            onTap: () => (a ?? 0) == 0 && (b ?? 0) > 0
                ? context.push(const ChecklistApprovalsRoute().location)
                : context.go(const InspectionApprovalsRoute().location),
          );
        case HomeBigTile.reportIssue:
          if (!can(ModuleKey.reportIssue)) return null;
          return _RoleBigData(
            id: 'reportIssue',
            icon: Icons.report_problem_outlined,
            title: c('issueTitle'),
            subtitle: c('issueHint'),
            onTap: () => context.push(const ReportIssueRoute().location),
          );
        case HomeBigTile.newInspection:
          if (!can(ModuleKey.inspect)) return null;
          return _RoleBigData(
            id: 'newInspection',
            icon: Icons.add_task_rounded,
            title: l10n.inspectionNewInspection,
            onTap: () => context.go(const NewInspectionRoute().location),
          );
        case HomeBigTile.resumeDraft:
          if (!can(ModuleKey.inspect)) return null;
          final InspectionDraftSummary? d =
              ref.watch(homeLatestInspectionDraftProvider).asData?.value;
          if (d == null) return null;
          final String asset = d.assetNo.trim();
          final String? site = d.site?.trim();
          return _RoleBigData(
            id: 'resumeDraft',
            icon: Icons.edit_outlined,
            title: l10n.homeResumeInspection,
            subtitle: _joinParts(<String?>[
              asset,
              d.vehicleType,
              if (d.total > 0) l10n.inspectionResumeProgress(d.filled, d.total),
            ]),
            onTap: () => context.go(
              NewInspectionRoute(
                assetNo: AssetNo(asset),
                siteName: site == null || site.isEmpty ? null : SiteName(site),
              ).location,
            ),
          );
        case HomeBigTile.teamNow:
          if (!can(ModuleKey.workshop)) return null;
          final AsyncValue<HomeTeamNow> t = ref.watch(homeTeamNowProvider);
          final HomeTeamNow? v = t.asData?.value;
          return _RoleBigData(
            id: 'teamNow',
            icon: Icons.groups_outlined,
            title: c('teamTitle'),
            subtitle: v == null
                ? (t.hasError
                    ? l10n.homeStatUnavailableCaption
                    : l10n.homeStatLoadingCaption)
                : '${_joinParts(<String?>[
                        '${c('working')} ${v.working}',
                        '${c('waiting')} ${v.waiting}',
                        '${c('free')} ${v.free}',
                      ])}\n${c('teamNote')}',
            onTap: () => context.push(const WorkshopRoute().location),
          );
        case HomeBigTile.assignJobs:
          // There is no assign screen on the phone yet: the job card board
          // is the best existing destination (work orders, else workshop).
          final bool board = can(ModuleKey.workorders);
          if (!board && !can(ModuleKey.workshop)) return null;
          final ({String value, String? note}) s = _countState(
            l10n,
            ref.watch(homeUnassignedJobsProvider),
            (HomeCount v) => v.text,
          );
          return _RoleBigData(
            id: 'assignJobs',
            icon: Icons.assignment_ind_outlined,
            title: c('assignTitle'),
            value: s.value,
            subtitle: s.note ?? c('assignGap'),
            onTap: () => board
                ? context.push(const WorkOrdersRoute().location)
                : context.push(const WorkshopRoute().location),
          );
        case HomeBigTile.myJobs:
          if (!can(ModuleKey.workshop)) return null;
          final AsyncValue<List<WorkshopJob>> jobs =
              ref.watch(homeMyJobsProvider);
          // Plant trades see "My jobs" only when they have one.
          if (plan.persona == HomePersona.plantTrade &&
              (jobs.asData?.value.isEmpty ?? true)) {
            return null;
          }
          final ({String value, String? note}) s = _countState(
            l10n,
            jobs,
            (List<WorkshopJob> v) => '${v.length}',
          );
          return _RoleBigData(
            id: 'myJobs',
            icon: Icons.home_repair_service_outlined,
            title: c('myJobsTitle'),
            value: s.value,
            subtitle: s.note ??
                ((jobs.asData?.value.isEmpty ?? false)
                    ? c('myJobsNone')
                    : c('myJobsCount').replaceAll('%count%', s.value)),
            onTap: () => context.push(const WorkshopRoute().location),
          );
        case HomeBigTile.plantChecks:
          if (!can(ModuleKey.checklists)) return null;
          final AsyncValue<List<ChecklistTemplateRecord>> d = due();
          final ({String value, String? note}) s = _countState(
            l10n,
            d,
            (List<ChecklistTemplateRecord> v) => '${v.length}',
          );
          return _RoleBigData(
            id: 'plantChecks',
            icon: Icons.fact_check_outlined,
            title: c('plantTitle'),
            value: s.value,
            subtitle: s.note ??
                ((d.asData?.value.isEmpty ?? false)
                    ? c('allDone')
                    : c('sheetsDue').replaceAll('%count%', s.value)),
            onTap: () => context.go(const ChecklistsRoute().location),
          );
        case HomeBigTile.workshopDaily:
          if (!can(ModuleKey.checklists)) return null;
          final List<ChecklistTemplateRecord> daily = <ChecklistTemplateRecord>[
            for (final ChecklistTemplateRecord t
                in due().asData?.value ?? const <ChecklistTemplateRecord>[])
              if (isWorkshopDaily(t)) t,
          ];
          // Shown only when it is due.
          if (daily.isEmpty) return null;
          final String? id = daily.first.template.id;
          return _RoleBigData(
            id: 'workshopDaily',
            icon: Icons.checklist,
            title: c('dailyTitle'),
            subtitle: c('dueToday'),
            onTap: () => id == null
                ? context.go(const ChecklistsRoute().location)
                : context.go(
                    ChecklistFillRoute(templateId: TemplateId(id)).location,
                  ),
          );
        case HomeBigTile.serialSearch:
          if (!can(ModuleKey.serial)) return null;
          return _RoleBigData(
            id: 'serialSearch',
            icon: Icons.confirmation_number_outlined,
            title: l10n.serialSearchTitle,
            onTap: () => context.push(const SerialSearchRoute().location),
          );
        case HomeBigTile.approvalsToSign:
          if (!canSign) return null;
          final ({String value, String? note}) s = _countState(
            l10n,
            ref.watch(homePendingInspectionApprovalsProvider),
            (HomePendingApprovals v) => '${v.count}',
          );
          return _RoleBigData(
            id: 'approvalsToSign',
            icon: Icons.done_all,
            title: c('signTitle'),
            value: s.value,
            subtitle: s.note ?? c('signHint').replaceAll('%count%', s.value),
            onTap: () => context.go(const InspectionApprovalsRoute().location),
          );
        case HomeBigTile.tyresDue:
          if (!can(ModuleKey.alerts)) return null;
          final ({String value, String? note}) s = _countState(
            l10n,
            ref.watch(tyreAlertsProvider),
            alertsText,
          );
          return _RoleBigData(
            id: 'tyresDue',
            icon: Icons.tire_repair_outlined,
            title: c('tyresDueTitle'),
            value: s.value,
            subtitle: s.note,
            onTap: () => context.push(const AlertsRoute().location),
          );
      }
    }

    // ---- rows ------------------------------------------------------------
    List<_RoleRowData> row(HomeRow r) {
      _RoleRowData simple(
        String id,
        IconData icon,
        String title,
        VoidCallback onTap, {
        bool danger = false,
      }) =>
          _RoleRowData(
            id: id,
            icon: icon,
            title: title,
            onTap: onTap,
            danger: danger,
          );
      switch (r) {
        case HomeRow.myVehicle:
          if (!can(ModuleKey.meter)) return const <_RoleRowData>[];
          final AsyncValue<HomeMyVehicle?> v = ref.watch(homeMyVehicleProvider);
          final HomeMyVehicle? car = v.asData?.value;
          final ({String value, String? note}) s =
              _countState(l10n, v, (HomeMyVehicle? x) => x?.assetNo ?? '-');
          return <_RoleRowData>[
            _RoleRowData(
              id: 'myVehicle',
              icon: Icons.local_shipping_outlined,
              title: c('myVehicle'),
              value: s.value,
              note: s.note ?? (car == null ? c('noVehicle') : car.site),
              onTap: () => car != null && can(ModuleKey.vehicles)
                  ? context.push(
                      VehiclesRoute(assetNo: AssetNo(car.assetNo)).location,
                    )
                  : context.go(
                      MeterLogRoute(
                        assetNo: car == null ? null : AssetNo(car.assetNo),
                      ).location,
                    ),
            ),
          ];
        case HomeRow.wash:
          if (!can(ModuleKey.washing)) return const <_RoleRowData>[];
          final AsyncValue<HomeMyVehicle?> v = ref.watch(homeMyVehicleProvider);
          String? note;
          if (v.hasError) {
            note = l10n.homeStatUnavailableCaption;
          } else if (v.asData != null) {
            final DateTime? last = v.asData!.value?.lastWash;
            if (last == null) {
              note = c('washNever');
            } else {
              final int days = DateTime(now.year, now.month, now.day)
                  .difference(DateTime(last.year, last.month, last.day))
                  .inDays;
              note = days <= 0
                  ? c('washToday')
                  : c('washDays').replaceAll('%count%', '$days');
            }
          } else {
            note = l10n.homeStatLoadingCaption;
          }
          return <_RoleRowData>[
            _RoleRowData(
              id: 'wash',
              icon: Icons.local_car_wash,
              title: c('wash'),
              note: note,
              onTap: () => context.go(const WashingRoute().location),
            ),
          ];
        case HomeRow.reportAccident:
          if (!can(ModuleKey.reportAccident)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'reportAccident',
              Icons.car_crash_outlined,
              c('reportAccident'),
              () => context.push(const AccidentReportRoute().location),
              danger: true,
            ),
          ];
        case HomeRow.dailyChecklist:
          if (!can(ModuleKey.checklists)) return const <_RoleRowData>[];
          final AsyncValue<List<ChecklistTemplateRecord>> d = due();
          // Only when a published sheet targets this role (and is not done).
          if (d.asData?.value.isEmpty ?? false) return const <_RoleRowData>[];
          if (d.isLoading && !d.hasValue) return const <_RoleRowData>[];
          return <_RoleRowData>[
            countRow<List<ChecklistTemplateRecord>>(
              id: 'dailyChecklist',
              icon: Icons.checklist,
              title: c('dailyChecklist'),
              state: d,
              text: (List<ChecklistTemplateRecord> v) => '${v.length}',
              onTap: () => context.go(const ChecklistsRoute().location),
            ),
          ];
        case HomeRow.myCharges:
          return <_RoleRowData>[
            _RoleRowData(
              id: 'myCharges',
              icon: Icons.receipt_long_outlined,
              title: c('charges'),
              note: c('chargesHint'),
              onTap: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                useSafeArea: true,
                builder: (BuildContext context) => const FractionallySizedBox(
                  heightFactor: 0.96,
                  child: DriverWorkspacePanel(),
                ),
              ),
            ),
          ];
        case HomeRow.dailySummary:
          if (!can(ModuleKey.reports)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'dailySummary',
              Icons.summarize_outlined,
              c('summary'),
              () => context.push(const ReportsRoute().location),
            ),
          ];
        case HomeRow.alerts:
          // The exceptions card already shows the same tyre alert count.
          if (plan.big.contains(HomeBigTile.exceptions)) {
            return const <_RoleRowData>[];
          }
          final _RoleRowData? a =
              tyresAttention(title: c('alerts'), id: 'alerts');
          return <_RoleRowData>[if (a != null) a];
        case HomeRow.offRoad:
          final _RoleRowData? a = offRoad();
          return <_RoleRowData>[if (a != null) a];
        case HomeRow.openAccidents:
          // Under the Report accident tile already for Fleet Supervisor.
          if (plan.big.contains(HomeBigTile.reportAccident) &&
              can(ModuleKey.reportAccident)) {
            return const <_RoleRowData>[];
          }
          final _RoleRowData? a = openAccidents();
          return <_RoleRowData>[if (a != null) a];
        case HomeRow.maintenanceDue:
          final _RoleRowData? a = maintenanceDue();
          return <_RoleRowData>[if (a != null) a];
        case HomeRow.tyresAttention:
          final _RoleRowData? a = tyresAttention();
          return <_RoleRowData>[if (a != null) a];
        case HomeRow.exceptions:
          return exceptionRows();
        case HomeRow.workshopStatus:
          if (!can(ModuleKey.workshopStatus)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'workshopStatus',
              Icons.car_repair_outlined,
              _tileMeta(l10n, 'workshopStatus').label,
              () => context.push(const WorkshopStatusRoute().location),
            ),
          ];
        case HomeRow.todaysPlan:
        case HomeRow.dueToday:
          if (!canPlan) return const <_RoleRowData>[];
          final bool inspections = r == HomeRow.dueToday;
          return <_RoleRowData>[
            countRow<MyWorkSnapshot>(
              id: inspections ? 'dueToday' : 'todaysPlan',
              icon: inspections
                  ? Icons.assignment_outlined
                  : Icons.event_available_outlined,
              title: inspections ? c('inspectionsDue') : c('plan'),
              state: ref.watch(myWorkSnapshotProvider),
              text: (MyWorkSnapshot v) => inspections
                  ? '${v.items.where((MyWorkItem i) => i.kind == MyWorkKind.inspectionPlan && (i.state == MyWorkState.overdue || i.state == MyWorkState.inProgress || i.state == MyWorkState.dueToday)).length}'
                  : '${openToday(v)}',
              onTap: openPlan,
            ),
          ];
        case HomeRow.sync:
          return <_RoleRowData>[
            countRow<int>(
              id: 'sync',
              icon: Icons.sync_rounded,
              title: c('sync'),
              state: ref.watch(homePendingSyncCountProvider),
              text: (int v) => '$v',
              onTap: () => context.go(const ProfileRoute().location),
            ),
          ];
        case HomeRow.repairRequest:
          if (!can(ModuleKey.repairRequest)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'repairRequest',
              Icons.build_outlined,
              c('repair'),
              () => context.push(const RepairRequestRoute().location),
            ),
          ];
        case HomeRow.meter:
          if (!can(ModuleKey.meter)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'meter',
              Icons.speed,
              c('meter'),
              () => context.go(const MeterLogRoute().location),
            ),
          ];
        case HomeRow.checklistsToSign:
          if (!can(ModuleKey.approvals)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            countRow<int>(
              id: 'checklistsToSign',
              icon: Icons.fact_check_outlined,
              title: c('checklistsToSign'),
              state: ref.watch(homeChecklistsToSignCountProvider),
              text: (int v) => '$v',
              onTap: () =>
                  context.push(const ChecklistApprovalsRoute().location),
            ),
          ];
        case HomeRow.waitingParts:
        case HomeRow.blocked:
          if (!can(ModuleKey.workshop)) return const <_RoleRowData>[];
          final bool parts = r == HomeRow.waitingParts;
          return <_RoleRowData>[
            countRow<HomeTeamNow>(
              id: parts ? 'waitingParts' : 'blocked',
              icon: parts ? Icons.inventory_2_outlined : Icons.timer_outlined,
              title: parts ? c('waitingParts') : c('blocked'),
              state: ref.watch(homeTeamNowProvider),
              text: (HomeTeamNow v) =>
                  '${parts ? v.waitingParts : v.blockedOver30}',
              onTap: () => context.push(const WorkshopRoute().location),
            ),
          ];
        case HomeRow.requestParts:
          if (!can(ModuleKey.workshop)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'requestParts',
              Icons.inventory_2_outlined,
              c('requestParts'),
              () => context.push(const WorkshopRoute().location),
            ),
          ];
        case HomeRow.reportProblem:
          if (!can(ModuleKey.reportIssue)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'reportProblem',
              Icons.report_problem_outlined,
              c('problemTitle'),
              () => context.push(const ReportIssueRoute().location),
            ),
          ];
        case HomeRow.recentInspections:
          if (!can(ModuleKey.history) || !can(ModuleKey.inspect)) {
            return const <_RoleRowData>[];
          }
          return <_RoleRowData>[
            countRow<List<HomeRecentAsset>>(
              id: 'recentInspections',
              icon: Icons.manage_search_rounded,
              title: c('recent'),
              state: ref.watch(homeRecentAssetsProvider),
              text: (List<HomeRecentAsset> v) => '${v.length}',
              onTap: () => context.go(const ActivityHistoryRoute().location),
            ),
          ];
        case HomeRow.stockReorder:
          if (!can(ModuleKey.stock)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            countRow<List<StockItem>>(
              id: 'stockReorder',
              icon: Icons.production_quantity_limits_outlined,
              title: c('reorder'),
              state: ref.watch(stockItemsProvider),
              text: (List<StockItem> v) =>
                  '${v.where((StockItem i) => i.needsReorder).length}',
              onTap: () => context.push(const StockCountRoute().location),
            ),
          ];
      }
    }

    final List<_RoleBigData> bigs = <_RoleBigData>[
      for (final HomeBigTile t in plan.big)
        if (big(t) case final _RoleBigData b) b,
    ];
    final List<_RoleRowData> rows = <_RoleRowData>[
      for (final HomeRow r in plan.rows) ...row(r),
    ];
    final List<String> chips = <String>[
      for (final String id in plan.chips)
        if (_moduleForTile(id) case final ModuleKey m when can(m)) id,
    ];

    return Column(
      key: HomeScreenKeys.rolePanel,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (int i = 0; i < bigs.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(height: 12),
          _RoleBigTile(data: bigs[i], primary: i == 0),
        ],
        if (rows.isNotEmpty) ...<Widget>[
          if (bigs.isNotEmpty) const SizedBox(height: 16),
          _RoleRowCard(rows: rows),
        ],
        if (chips.isNotEmpty || plan.showMore) ...<Widget>[
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final String id in chips)
                _RoleChip(
                  id: id,
                  icon: _tileMeta(l10n, id).icon,
                  label: _tileMeta(l10n, id).label,
                  onTap: () => _openHomeTile(context, id),
                ),
              if (plan.showMore)
                _RoleChip(
                  id: 'more',
                  icon: Icons.apps_rounded,
                  label: c('more'),
                  onTap: onMore,
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// A big tile: the first is filled with the brand colour, the second is a
/// surface card. Grows with the text (no fixed height) so 2x text fits.
class _RoleBigTile extends StatelessWidget {
  const _RoleBigTile({required this.data, required this.primary});

  final _RoleBigData data;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color fg = primary ? palette.onPrimary : palette.text;
    final Color muted =
        primary ? palette.onPrimary.withValues(alpha: 0.86) : palette.textMuted;
    final TextTheme text = Theme.of(context).textTheme;
    final Widget header = Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 14, 14, 14),
      child: Row(
        children: <Widget>[
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: primary ? palette.onPrimary : palette.primarySoft,
              shape: BoxShape.circle,
            ),
            child: TpIcon(data.icon, color: palette.primary, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  data.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleMedium?.copyWith(
                    color: fg,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if (data.subtitle != null && data.subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    data.subtitle!,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall?.copyWith(color: muted),
                  ),
                ],
              ],
            ),
          ),
          if (data.value != null) ...<Widget>[
            const SizedBox(width: 10),
            Text(
              data.value!,
              style: text.headlineSmall?.copyWith(
                color: fg,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
          if (data.onTap != null)
            Icon(Icons.chevron_right_rounded, color: muted),
        ],
      ),
    );
    return Material(
      key: HomeScreenKeys.roleBig(data.id),
      color: primary ? palette.primary : palette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.md),
        side: primary ? BorderSide.none : BorderSide(color: palette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: data.onTap == null ? 64 : 88,
            ),
            child: data.onTap == null
                ? Semantics(header: true, child: header)
                : InkWell(onTap: data.onTap, child: header),
          ),
          if (data.children.isNotEmpty)
            ColoredBox(
              color: palette.surface,
              child: Column(
                children: <Widget>[
                  for (int i = 0; i < data.children.length; i++) ...<Widget>[
                    if (i > 0) Divider(height: 1, color: palette.border),
                    _RoleRow(data: data.children[i]),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _RoleRowCard extends StatelessWidget {
  const _RoleRowCard({required this.rows});

  final List<_RoleRowData> rows;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: palette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.md),
        side: BorderSide(color: palette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0) Divider(height: 1, color: palette.border),
            _RoleRow(data: rows[i]),
          ],
        ],
      ),
    );
  }
}

/// One compact row: at least 72dp tall, the whole row one tap target.
class _RoleRow extends StatelessWidget {
  const _RoleRow({required this.data});

  final _RoleRowData data;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpStatusColors tone = data.danger ? palette.critical : palette.info;
    return InkWell(
      key: HomeScreenKeys.roleRow(data.id),
      onTap: data.onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 72),
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(14, 10, 10, 10),
          child: Row(
            children: <Widget>[
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: tone.soft,
                  shape: BoxShape.circle,
                ),
                child: TpIcon(data.icon, color: tone.base, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      data.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: text.titleSmall?.copyWith(
                        color: data.danger ? tone.base : palette.text,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (data.note != null && data.note!.isNotEmpty)
                      Text(
                        data.note!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style:
                            text.bodySmall?.copyWith(color: palette.textMuted),
                      ),
                  ],
                ),
              ),
              if (data.value != null) ...<Widget>[
                const SizedBox(width: 8),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 120),
                  child: Text(
                    data.value!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: text.titleMedium?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
              Icon(Icons.chevron_right_rounded, color: palette.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _RoleChip extends StatelessWidget {
  const _RoleChip({
    required this.id,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final String id;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Material(
      key: HomeScreenKeys.roleChip(id),
      color: palette.surface,
      shape: StadiumBorder(side: BorderSide(color: palette.border)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpIcon(icon, size: 18, color: palette.primary),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
