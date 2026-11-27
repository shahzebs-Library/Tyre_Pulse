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
    required this.title,
    required this.onTap,
    this.subtitle,
    this.value,
    this.children = const <_RoleRowData>[],
  });

  final String id;
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
    required this.title,
    required this.onTap,
    this.value,
    this.note,
    this.danger = false,
  });

  final String id;
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
    final ListDrilldownBox drill = ref.read(listDrilldownProvider);
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
      required String title,
      required AsyncValue<T> state,
      required String Function(T) text,
      required VoidCallback onTap,
      bool danger = false,
    }) {
      final ({String value, String? note}) s = _countState(l10n, state, text);
      return _RoleRowData(
        id: id,
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
            title: c('offRoad'),
            state: ref.watch(homeOffRoadCountProvider),
            text: (int v) => '$v',
            onTap: () {
              drill.request(ListDrilldown.offRoad);
              context.push(const VehiclesRoute().location);
            },
          )
        : null;
    _RoleRowData? openAccidents() => can(ModuleKey.accidents)
        ? countRow<int>(
            id: 'openAccidents',
            title: c('openAccidents'),
            state: ref.watch(homeOpenAccidentsCountProvider),
            text: (int v) => '$v',
            onTap: () {
              drill.request(ListDrilldown.openAccidents);
              context.go(const AccidentDashboardRoute().location);
            },
          )
        : null;
    _RoleRowData? maintenanceDue() => can(ModuleKey.pm)
        ? countRow<int>(
            id: 'maintenanceDue',
            title: c('maintenanceOverdue'),
            state: ref.watch(homeMaintenanceOverdueCountProvider),
            text: (int v) => '$v',
            onTap: () {
              drill.request(ListDrilldown.maintenanceOverdue);
              context.push(const PreventiveMaintenanceRoute().location);
            },
          )
        : null;
    String alertsText(List<TyreAlert> v) =>
        v.length >= 300 ? '${v.length}+' : '${v.length}';
    _RoleRowData? tyresAttention({String? title, String id = 'tyres'}) =>
        can(ModuleKey.alerts)
            ? countRow<List<TyreAlert>>(
                id: id,
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
            title: c('issueTitle'),
            subtitle: c('issueHint'),
            onTap: () => context.push(const ReportIssueRoute().location),
          );
        case HomeBigTile.newInspection:
          if (!can(ModuleKey.inspect)) return null;
          return _RoleBigData(
            id: 'newInspection',
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
        String title,
        VoidCallback onTap, {
        bool danger = false,
      }) =>
          _RoleRowData(
            id: id,
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
        case HomeRow.myConcerns:
          return <_RoleRowData>[
            _RoleRowData(
              id: 'myConcerns',
              title: DriverConcernsCopy.of(context)('raise'),
              note: DriverConcernsCopy.of(context)('title'),
              onTap: () => Navigator.of(context).push<void>(
                MaterialPageRoute<void>(
                  builder: (BuildContext context) => const MyConcernsScreen(),
                ),
              ),
            ),
          ];
        case HomeRow.dailySummary:
          if (!can(ModuleKey.reports)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'dailySummary',
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
              c('repair'),
              () => context.push(const RepairRequestRoute().location),
            ),
          ];
        case HomeRow.meter:
          if (!can(ModuleKey.meter)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'meter',
              c('meter'),
              () => context.go(const MeterLogRoute().location),
            ),
          ];
        case HomeRow.checklistsToSign:
          if (!can(ModuleKey.approvals)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            countRow<int>(
              id: 'checklistsToSign',
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
              c('requestParts'),
              () => context.push(const WorkshopRoute().location),
            ),
          ];
        case HomeRow.reportProblem:
          if (!can(ModuleKey.reportIssue)) return const <_RoleRowData>[];
          return <_RoleRowData>[
            simple(
              'reportProblem',
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

    // The approved Home hierarchy: the primary call to action, the command
    // card, "Today's work" rows on gem tiles, then the quick-action grid.
    final List<Widget> children = <Widget>[];
    for (int i = 0; i < bigs.length; i++) {
      final _RoleBigData b = bigs[i];
      if (i > 0) children.add(const SizedBox(height: 12));
      if (b.onTap == null) {
        // A card of counts (Today's exceptions): a section header over rows.
        children
          ..add(_HomeSectionHeader(title: b.title))
          ..add(const SizedBox(height: 10));
      } else if (i == 0) {
        children.add(_RolePrimaryAction(data: b));
      } else {
        children.add(_RoleCommandCard(data: b));
      }
      if (b.children.isNotEmpty) {
        children
          ..add(const SizedBox(height: 10))
          ..add(_RoleRowCard(rows: b.children));
      }
    }
    if (rows.isNotEmpty) {
      children
        ..add(const SizedBox(height: 26))
        ..add(_HomeSectionHeader(title: l10n.homeTodaysWork))
        ..add(const SizedBox(height: 10))
        ..add(_RoleRowCard(rows: rows));
    }
    final List<
        ({
          String id,
          String label,
          TpGemSpec gem,
          TpGemTone? tone,
          VoidCallback onTap,
        })> actions = <({
      String id,
      String label,
      TpGemSpec gem,
      TpGemTone? tone,
      VoidCallback onTap,
    })>[
      for (final String id in chips)
        (
          id: id,
          label: _tileMeta(l10n, id).label,
          gem: _roleGem(id).spec,
          tone: _roleGem(id).tone,
          onTap: () => _openHomeTile(context, id),
        ),
      if (plan.showMore)
        (
          id: 'more',
          label: l10n.homeMoreAction,
          gem: TpGemSpec.more,
          tone: null,
          onTap: onMore,
        ),
    ];
    if (actions.isNotEmpty) {
      children
        ..add(const SizedBox(height: 26))
        ..add(_HomeSectionHeader(title: l10n.homeQuickActions))
        ..add(const SizedBox(height: 12))
        ..add(
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              // Three per row on a phone, two when narrow, like the original
              // quick actions. The column width is fixed so a short list (a
              // lone More) stays a tile instead of stretching edge to edge.
              final int perRow = constraints.maxWidth >= 280 ? 3 : 2;
              double widthFor(int index) =>
                  (constraints.maxWidth - (perRow - 1) * 10) / perRow;

              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  for (int i = 0; i < actions.length; i++)
                    SizedBox(
                      width: widthFor(i),
                      child: _DashboardActionCard(
                        key: HomeScreenKeys.roleChip(actions[i].id),
                        label: actions[i].label,
                        gem: actions[i].gem,
                        gemTone: actions[i].tone,
                        onTap: actions[i].onTap,
                      ),
                    ),
                ],
              );
            },
          ),
        );
    }
    return Column(
      key: HomeScreenKeys.rolePanel,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }
}

/// The approved gem (glyph and meaning colour, [TpGemSpec]) for every role
/// tile, row and quick action, by id. Red is kept for tyre problems and
/// accidents only, as [TpGemTone] requires.
({TpGemSpec spec, TpGemTone? tone}) _roleGem(String id) => switch (id) {
      // Big tiles.
      'meterToday' || 'meter' => (spec: TpGemSpec.pressure, tone: null),
      'reportProblem' || 'reportIssue' || 'repairRequest' => (
          spec: TpGemSpec.reportIssue,
          tone: null
        ),
      'handoverSignoff' => (spec: TpGemSpec.approvals, tone: null),
      'reportAccident' || 'openAccidents' => (
          spec: TpGemSpec.reportAccident,
          tone: null
        ),
      'approvalsWaiting' || 'approvalsToSign' || 'checklistsToSign' => (
          spec: TpGemSpec.approvals,
          tone: null
        ),
      'resumeDraft' => (spec: TpGemSpec.inspectionsDue, tone: null),
      'teamNow' => (spec: TpGemSpec.inspectionsDue, tone: TpGemTone.green),
      'assignJobs' => (spec: TpGemSpec.approvals, tone: TpGemTone.blue),
      'myJobs' => (spec: TpGemSpec.inspectionsDue, tone: null),
      'plantChecks' || 'workshopDaily' || 'dailyChecklist' => (
          spec: TpGemSpec.inspectionsDue,
          tone: TpGemTone.green
        ),
      'serialSearch' || 'serial' => (spec: TpGemSpec.tyre, tone: null),
      'tyresDue' || 'tyres' || 'alerts' => (
          spec: TpGemSpec.tyresNeedAttention,
          tone: null
        ),
      // Rows.
      'offRoad' => (spec: TpGemSpec.asset, tone: TpGemTone.amber),
      'maintenanceDue' => (spec: TpGemSpec.reportIssue, tone: null),
      'myVehicle' || 'vehicles' => (spec: TpGemSpec.asset, tone: null),
      'wash' || 'washing' => (spec: TpGemSpec.washing, tone: null),
      'myCharges' => (spec: TpGemSpec.reportIssue, tone: TpGemTone.slate),
      'myConcerns' => (spec: TpGemSpec.reportIssue, tone: TpGemTone.violet),
      'dailySummary' => (
          spec: TpGemSpec.inspectionsDue,
          tone: TpGemTone.violet
        ),
      'workshopStatus' => (spec: TpGemSpec.asset, tone: TpGemTone.teal),
      'todaysPlan' || 'dueToday' || 'recentInspections' => (
          spec: TpGemSpec.inspectionsDue,
          tone: null
        ),
      'sync' => (spec: TpGemSpec.pendingSync, tone: null),
      'waitingParts' || 'requestParts' => (
          spec: TpGemSpec.stockCount,
          tone: TpGemTone.amber
        ),
      'blocked' => (spec: TpGemSpec.reportIssue, tone: null),
      'reportProblemRow' => (spec: TpGemSpec.reportIssue, tone: null),
      'stockReorder' => (spec: TpGemSpec.stockCount, tone: TpGemTone.amber),
      // Quick actions.
      'scanner' => (spec: TpGemSpec.scan, tone: null),
      'stock' => (spec: TpGemSpec.stockCount, tone: null),
      'records' || 'tyreChange' => (spec: TpGemSpec.tyre, tone: null),
      _ => (spec: TpGemSpec.more, tone: null),
    };

/// The first big tile: the approved full-width "New inspection" call to
/// action (green, white disc), extended with an optional line under the
/// label and a count.
class _RolePrimaryAction extends StatelessWidget {
  const _RolePrimaryAction({required this.data});

  final _RoleBigData data;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final ({TpGemSpec spec, TpGemTone? tone}) gem = _roleGem(data.id);
    final String? subtitle =
        data.subtitle == null || data.subtitle!.isEmpty ? null : data.subtitle;
    return Semantics(
      button: true,
      label: <String>[
        data.title,
        if (subtitle != null) subtitle,
        if (data.value != null) data.value!,
      ].join(', '),
      excludeSemantics: true,
      child: Material(
        key: HomeScreenKeys.roleBig(data.id),
        borderRadius: BorderRadius.circular(TpRadius.md),
        clipBehavior: Clip.antiAlias,
        color: palette.primary,
        child: InkWell(
          onTap: data.onTap,
          splashColor: palette.onPrimary.withValues(alpha: 0.12),
          highlightColor: palette.onPrimary.withValues(alpha: 0.06),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 68),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              child: Row(
                mainAxisAlignment: subtitle == null && data.value == null
                    ? MainAxisAlignment.center
                    : MainAxisAlignment.start,
                children: <Widget>[
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: palette.onPrimary,
                      shape: BoxShape.circle,
                    ),
                    child: data.id == 'newInspection'
                        ? Icon(
                            Icons.add_rounded,
                            color: palette.primary,
                            size: 26,
                          )
                        : Center(
                            child: TpAssetIcon(
                              gem.spec.glyph,
                              size: 22,
                              color: palette.primary,
                            ),
                          ),
                  ),
                  const SizedBox(width: 14),
                  Flexible(
                    fit: subtitle == null && data.value == null
                        ? FlexFit.loose
                        : FlexFit.tight,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          data.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.titleLarge?.copyWith(
                            color: palette.onPrimary,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.2,
                          ),
                        ),
                        if (subtitle != null)
                          Text(
                            subtitle,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: text.bodyMedium?.copyWith(
                              color: palette.onPrimary.withValues(alpha: 0.9),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (data.value != null) ...<Widget>[
                    const SizedBox(width: 10),
                    Text(
                      data.value!,
                      style: text.headlineSmall?.copyWith(
                        color: palette.onPrimary,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The second big tile: the approved command card (the accident shortcut's
/// shape) with the gem's meaning colour on its border and disc.
class _RoleCommandCard extends StatelessWidget {
  const _RoleCommandCard({required this.data});

  final _RoleBigData data;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final ({TpGemSpec spec, TpGemTone? tone}) gem = _roleGem(data.id);
    final TpGemTone tone = gem.tone ?? gem.spec.tone;
    final Color accent = tone.end;
    final String? subtitle =
        data.subtitle == null || data.subtitle!.isEmpty ? null : data.subtitle;
    return Material(
      key: HomeScreenKeys.roleBig(data.id),
      color: palette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.md),
        side: BorderSide(color: accent.withValues(alpha: 0.28)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: data.onTap,
        splashColor: accent.withValues(alpha: 0.12),
        highlightColor: accent.withValues(alpha: 0.06),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 72),
          child: Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(12, 12, 10, 12),
            child: Row(
              children: <Widget>[
                TpGem.spec(gem.spec, tone: gem.tone, size: TpGemSize.md),
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
                          color: palette.text,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall?.copyWith(
                            color: accent,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                    ],
                  ),
                ),
                if (data.value != null) ...<Widget>[
                  const SizedBox(width: 8),
                  Text(
                    data.value!,
                    style: text.headlineSmall?.copyWith(
                      color: accent,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
                Icon(
                  // Mirrors itself under RTL (matchTextDirection).
                  Icons.chevron_right_rounded,
                  color: palette.textMuted,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The rows, in the approved "Today's work" card (rounded, bordered,
/// dividers between rows).
class _RoleRowCard extends StatelessWidget {
  const _RoleRowCard({required this.rows});

  final List<_RoleRowData> rows;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Material(
      color: palette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.lg),
        side: BorderSide(color: palette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0)
              Divider(
                height: 1,
                indent: 72,
                color: palette.border,
              ),
            _RoleRow(data: rows[i]),
          ],
        ],
      ),
    );
  }
}

/// One compact row on a gem tile: at least 72dp, the whole row one tap
/// target, the count in the gem's meaning colour (the summary tiles' rule).
class _RoleRow extends StatelessWidget {
  const _RoleRow({required this.data});

  final _RoleRowData data;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final ({TpGemSpec spec, TpGemTone? tone}) gem =
        _roleGem(data.id == 'reportProblem' ? 'reportProblemRow' : data.id);
    final bool unknown = data.value == '-';
    final TpGemTone tone =
        unknown ? TpGemTone.slate : (gem.tone ?? gem.spec.tone);
    final String? note = data.note;
    return Semantics(
      button: true,
      label: <String>[
        data.title,
        if (data.value != null) data.value!,
        if (note != null) note,
      ].join(', '),
      excludeSemantics: true,
      child: InkWell(
        key: HomeScreenKeys.roleRow(data.id),
        onTap: data.onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 72),
          child: Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(12, 10, 8, 10),
            child: Row(
              children: <Widget>[
                TpGem.spec(gem.spec, tone: tone, size: TpGemSize.md),
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
                          color: data.danger ? TpGemTone.red.end : palette.text,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (note != null && note.isNotEmpty)
                        Text(
                          note,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall
                              ?.copyWith(color: palette.textMuted),
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
                      style: text.titleLarge?.copyWith(
                        color: unknown ? palette.textMuted : tone.end,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ],
                Icon(
                  // Mirrors itself under RTL (matchTextDirection).
                  Icons.chevron_right_rounded,
                  color: palette.textMuted,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
