library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_workflow_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_claims_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_case_workspaces.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_workstream_editor.dart';

abstract final class AccidentCaseScreenKeys {
  static const Key tabs = Key('accident.case.tabs');
  static const Key workspaceNavigation = Key('accident.case.navigation');
  static const Key previousWorkspace = Key('accident.case.previous');
  static const Key nextWorkspace = Key('accident.case.next');
  static const Key workspaceSelector = Key('accident.case.selector');
  static const Key boundaryAction = Key('accident.case.boundaryAction');
  static const Key header = Key('accident.case.header');
  static const Key damageMapping = Key('accident.case.damageMapping');
  static const Key fleet = Key('accident.case.fleet');
  static const Key responsibility = Key('accident.case.responsibility');
  static const Key insurance = Key('accident.case.insurance');
  static const Key assessment = Key('accident.case.assessment');
  static const Key externalWorkshop = Key('accident.case.externalWorkshop');
  static const Key timeline = Key('accident.case.timeline');

  // Compatibility aliases for callers that still link to the former grouping.
  static const Key incident = damageMapping;
  static const Key overview = damageMapping;
  static const Key evidence = damageMapping;
  static const Key repair = assessment;
  static const Key more = timeline;
  static const Key readOnlyAction = Key('accident.case.readOnlyStatus');
}

enum _CaseMenuAction { claim, updateWorkstream, waiveWorkstream }

/// Seven distinct role workspaces backed by the accident row, the real
/// workstream ledger and the authenticated user's real notification inbox.
///
/// Workstream status updates use the verified online RPC. Missing fields remain
/// visibly unrecorded; the remaining case decisions retain their read-only boundary.
class AccidentCaseScreen extends ConsumerStatefulWidget {
  const AccidentCaseScreen({required this.route, super.key});
  final AccidentCaseRoute route;

  @override
  ConsumerState<AccidentCaseScreen> createState() => _AccidentCaseScreenState();
}

class _AccidentCaseScreenState extends ConsumerState<AccidentCaseScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  late final List<ScrollController> _scrollControllers;
  AccidentCaseSnapshot? _snapshot;
  AppError? _error;
  bool _loading = true;
  bool _initialWorkspaceChosen = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(
      length: AccidentCaseWorkspace.values.length,
      vsync: this,
    )..addListener(_resetSelectedWorkspaceToTop);
    _scrollControllers = List<ScrollController>.generate(
      AccidentCaseWorkspace.values.length,
      (int index) => ScrollController(),
    );
    unawaited(_load());
  }

  @override
  void dispose() {
    _tabController
      ..removeListener(_resetSelectedWorkspaceToTop)
      ..dispose();
    for (final ScrollController controller in _scrollControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  void _resetSelectedWorkspaceToTop() {
    if (_tabController.indexIsChanging) return;
    final ScrollController controller =
        _scrollControllers[_tabController.index];
    if (controller.hasClients && controller.offset != 0) controller.jumpTo(0);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AccidentCaseSnapshot? snapshot =
          await ref.read(accidentRepositoryProvider).caseById(
                widget.route.accidentId.value,
                country: ref.read(activeCountryProvider),
              );
      if (!mounted) return;
      setState(() {
        _snapshot = snapshot;
        _loading = false;
      });
      if (!_initialWorkspaceChosen && snapshot != null) {
        _initialWorkspaceChosen = true;
        final int activeIndex = _activeWorkspaceIndex(snapshot.workstreams);
        if (activeIndex != _tabController.index) {
          _tabController.animateTo(activeIndex);
        }
      }
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = accidentAppError(error, AccidentCopy.of(context));
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AccidentCopy copy = AccidentCopy.of(context);
    final bool hasRecord = _snapshot != null;
    return TpScaffold(
      backFallback: fallback,
      backgroundColor: TpPalette.of(context).surface,
      appBar: TpAppBar(
        title: AppLocalizations.of(context).accidentCaseAppBarTitle,
        backFallback: fallback,
        actions: hasRecord
            ? <Widget>[
                IconButton(
                  key: AccidentCaseScreenKeys.tabs,
                  tooltip: copy('endToEnd'),
                  onPressed: _chooseWorkspace,
                  icon: const Icon(Icons.account_tree_outlined),
                ),
                IconButton(
                  key: AccidentCaseScreenKeys.boundaryAction,
                  tooltip: copy('boundary'),
                  onPressed: () => _showReadOnlyBoundary(copy),
                  icon: const Icon(Icons.info_outline_rounded),
                ),
                PopupMenuButton<_CaseMenuAction>(
                  tooltip: MaterialLocalizations.of(context).moreButtonTooltip,
                  onSelected: _handleCaseMenu,
                  itemBuilder: (BuildContext context) =>
                      <PopupMenuEntry<_CaseMenuAction>>[
                    PopupMenuItem<_CaseMenuAction>(
                      value: _CaseMenuAction.claim,
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.policy_outlined),
                        title: Text(accidentClaimCopy(context, 'title')),
                      ),
                    ),
                    if (_editableWorkstreams.isNotEmpty)
                      PopupMenuItem<_CaseMenuAction>(
                        value: _CaseMenuAction.updateWorkstream,
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.edit_note),
                          title: Text(workstreamEditorCopy(context, 'title')),
                        ),
                      ),
                    if (_waivableWorkstreams.isNotEmpty)
                      PopupMenuItem<_CaseMenuAction>(
                        value: _CaseMenuAction.waiveWorkstream,
                        child: ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.playlist_remove),
                          title: Text(
                            workstreamEditorCopy(context, 'waiverTitle'),
                          ),
                        ),
                      ),
                  ],
                ),
              ]
            : null,
      ),
      body: _body(copy),
    );
  }

  Widget _body(AccidentCopy copy) {
    if (_loading) return TpLoadingState(message: copy('loadingWorkstreams'));
    if (_error != null) return TpErrorState(error: _error!, onRetry: _load);
    final AccidentCaseSnapshot? snapshot = _snapshot;
    if (snapshot == null) {
      return TpEmptyState(
        icon: Icons.search_off_outlined,
        title: copy('caseNotFound'),
        message: copy('caseNotFoundMessage'),
      );
    }
    final List<Key> bodyKeys = <Key>[
      AccidentCaseScreenKeys.damageMapping,
      AccidentCaseScreenKeys.fleet,
      AccidentCaseScreenKeys.responsibility,
      AccidentCaseScreenKeys.insurance,
      AccidentCaseScreenKeys.assessment,
      AccidentCaseScreenKeys.externalWorkshop,
      AccidentCaseScreenKeys.timeline,
    ];
    return Column(
      children: <Widget>[
        AnimatedBuilder(
          animation: _tabController,
          builder: (context, _) => _workspaceNavigation(),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: <Widget>[
              for (final AccidentCaseWorkspace workspace
                  in AccidentCaseWorkspace.values)
                AccidentCaseWorkspaceView(
                  workspace: workspace,
                  snapshot: snapshot,
                  onRefresh: _load,
                  controller: _scrollControllers[workspace.index],
                  bodyKey: bodyKeys[workspace.index],
                  onOpenIncident: () => Navigator.of(context).maybePop(),
                  onOpenClaims: () => unawaited(_openClaims()),
                  onViewDamage: () => _tabController.animateTo(
                    AccidentCaseWorkspace.damageMapping.index,
                  ),
                  onUpdateWorkstream: _editableWorkstreams.any(
                    (item) => workspace.workstreamKeys.contains(item.key),
                  )
                      ? () => unawaited(
                            _editWorkstream(keys: workspace.workstreamKeys),
                          )
                      : null,
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _workspaceNavigation() {
    final AccidentCaseWorkspace current =
        AccidentCaseWorkspace.values[_tabController.index];
    final AccidentCaseWorkflowCopy copy = AccidentCaseWorkflowCopy.of(context);
    final MaterialLocalizations labels = MaterialLocalizations.of(context);
    final String step = copy('stepOf')
        .replaceAll('%step%', '${current.step}')
        .replaceAll('%total%', '${AccidentCaseWorkspace.values.length}');
    final bool canUpdate = _editableWorkstreams.any(
      (item) => current.workstreamKeys.contains(item.key),
    );
    return Material(
      key: AccidentCaseScreenKeys.workspaceNavigation,
      color: TpPalette.of(context).surface,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              IconButton(
                key: AccidentCaseScreenKeys.previousWorkspace,
                tooltip: labels.previousPageTooltip,
                onPressed: current.index == 0
                    ? null
                    : () => _tabController.animateTo(current.index - 1),
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: TextButton(
                  key: AccidentCaseScreenKeys.workspaceSelector,
                  onPressed: _chooseWorkspace,
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Column(
                          children: <Widget>[
                            Text(
                              step,
                              style: Theme.of(context).textTheme.labelSmall,
                            ),
                            Text(
                              copy(current.labelKey),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.expand_more),
                    ],
                  ),
                ),
              ),
              IconButton(
                key: AccidentCaseScreenKeys.nextWorkspace,
                tooltip: labels.nextPageTooltip,
                onPressed:
                    current.index == AccidentCaseWorkspace.values.length - 1
                        ? null
                        : () => _tabController.animateTo(current.index + 1),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
          if (current == AccidentCaseWorkspace.insurance || canUpdate)
            Wrap(
              alignment: WrapAlignment.center,
              children: <Widget>[
                if (current == AccidentCaseWorkspace.insurance)
                  TextButton.icon(
                    onPressed: _openClaims,
                    icon: const Icon(Icons.policy_outlined),
                    label: Text(accidentClaimCopy(context, 'title')),
                  ),
                if (canUpdate)
                  TextButton.icon(
                    onPressed: _editWorkstream,
                    icon: const Icon(Icons.edit_note),
                    label: Text(workstreamEditorCopy(context, 'title')),
                  ),
              ],
            ),
          const Divider(height: 1),
        ],
      ),
    );
  }

  Future<void> _openClaims() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => AccidentClaimsScreen(
          accidentId: widget.route.accidentId.value,
          claimAmount: _snapshot?.accident.claimAmount,
        ),
      ),
    );
    if (mounted) await _load();
  }

  void _handleCaseMenu(_CaseMenuAction action) {
    switch (action) {
      case _CaseMenuAction.claim:
        unawaited(_openClaims());
      case _CaseMenuAction.updateWorkstream:
        unawaited(_editWorkstream());
      case _CaseMenuAction.waiveWorkstream:
        unawaited(_editWorkstream(waiver: true));
    }
  }

  Future<void> _chooseWorkspace() async {
    final AccidentCaseSnapshot? snapshot = _snapshot;
    if (snapshot == null) return;
    final AccidentCopy copy = AccidentCopy.of(context);
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
    final int? selected = await TpBottomSheet.show<int>(
      context: context,
      title: copy('endToEnd'),
      builder: (BuildContext sheetContext) => ListView.separated(
        shrinkWrap: true,
        itemCount: AccidentCaseWorkspace.values.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (BuildContext context, int index) {
          final AccidentCaseWorkspace workspace =
              AccidentCaseWorkspace.values[index];
          final AccidentWorkstream? workstream = snapshot.workstreams
              .where((item) => workspace.workstreamKeys.contains(item.key))
              .firstOrNull;
          return ListTile(
            selected: index == _tabController.index,
            leading: CircleAvatar(
              child: Text('${workspace.step}'),
            ),
            title: Text(workflowCopy(workspace.labelKey)),
            subtitle: workstream == null
                ? Text(copy('notRecorded'))
                : Text(humaniseAccidentToken(workstream.status)),
            trailing: Icon(workspace.icon),
            onTap: () => Navigator.of(sheetContext).pop(index),
          );
        },
      ),
    );
    if (selected != null && mounted) {
      _tabController.animateTo(selected);
    }
  }

  int _activeWorkspaceIndex(List<AccidentWorkstream> workstreams) {
    AccidentWorkstream? active;
    for (final AccidentWorkstream item in workstreams) {
      if (item.chip == AccidentWorkstreamChip.inProgress) {
        active = item;
        break;
      }
    }
    active ??= workstreams
        .where((item) => item.required != false)
        .where((item) => item.chip == AccidentWorkstreamChip.pending)
        .firstOrNull;
    if (active == null) return 0;
    final int index = AccidentCaseWorkspace.values.indexWhere(
      (workspace) => workspace.workstreamKeys.contains(active!.key),
    );
    return index < 0 ? 0 : index;
  }

  List<AccidentWorkstream> get _editableWorkstreams =>
      (_snapshot?.workstreams ?? const <AccidentWorkstream>[])
          .where(
            (ws) =>
                accidentWorkstreamOrder.contains(ws.key) &&
                ws.notApplicable != true &&
                ws.status != 'not_required',
          )
          .toList();

  List<AccidentWorkstream> get _waivableWorkstreams => _editableWorkstreams
      .where((ws) => AccidentWorkstreamRepository.canWaive(ws.key))
      .toList();

  Future<void> _editWorkstream({
    bool waiver = false,
    List<String>? keys,
  }) async {
    final List<AccidentWorkstream> available =
        waiver ? _waivableWorkstreams : _editableWorkstreams;
    final List<AccidentWorkstream> scoped = keys == null
        ? available
        : available.where((item) => keys.contains(item.key)).toList();
    if (scoped.isEmpty) return;
    final bool? saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AccidentWorkstreamEditor(
        accidentId: widget.route.accidentId.value,
        workstreams: scoped,
        waiver: waiver,
      ),
    );
    if (saved == true && mounted) await _load();
  }

  Future<void> _showReadOnlyBoundary(AccidentCopy copy) =>
      showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (BuildContext context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              TpSpace.xl,
              0,
              TpSpace.xl,
              TpSpace.xxl,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  copy('boundary'),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: TpSpace.sm),
                Text(copy('boundaryMessage')),
              ],
            ),
          ),
        ),
      );
}
