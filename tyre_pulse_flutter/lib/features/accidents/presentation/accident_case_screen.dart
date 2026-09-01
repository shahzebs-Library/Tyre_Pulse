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
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_workflow_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_case_workspaces.dart';

abstract final class AccidentCaseScreenKeys {
  static const Key tabs = Key('accident.case.tabs');
  static const Key boundaryAction = Key('accident.case.boundaryAction');
  static const Key header = Key('accident.case.header');
  static const Key incident = Key('accident.case.incident');
  static const Key fleet = Key('accident.case.fleet');
  static const Key responsibility = Key('accident.case.responsibility');
  static const Key insurance = Key('accident.case.insurance');
  static const Key assessment = Key('accident.case.assessment');
  static const Key externalWorkshop = Key('accident.case.externalWorkshop');
  static const Key timeline = Key('accident.case.timeline');

  // Compatibility aliases for callers that still link to the former grouping.
  static const Key overview = incident;
  static const Key evidence = incident;
  static const Key repair = assessment;
  static const Key more = timeline;
  static const Key readOnlyAction = Key('accident.case.readOnlyStatus');
}

/// Seven distinct role workspaces backed by the accident row, the real
/// workstream ledger and the authenticated user's real notification inbox.
///
/// Server mutations are deliberately absent until their RPC and permission
/// contracts are verified. Missing fields remain visibly unrecorded.
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
    final AccidentCaseWorkflowCopy workflowCopy =
        AccidentCaseWorkflowCopy.of(context);
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
                  key: AccidentCaseScreenKeys.boundaryAction,
                  tooltip: copy('boundary'),
                  onPressed: () => _showReadOnlyBoundary(copy),
                  icon: const Icon(Icons.more_vert_rounded),
                ),
              ]
            : null,
        bottom: hasRecord
            ? PreferredSize(
                preferredSize: const Size.fromHeight(48),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TabBar(
                    key: AccidentCaseScreenKeys.tabs,
                    controller: _tabController,
                    isScrollable: true,
                    tabAlignment: TabAlignment.start,
                    dividerColor: TpPalette.of(context).border,
                    indicatorColor: TpPalette.of(context).primary,
                    indicatorWeight: 3,
                    labelColor: TpPalette.of(context).primary,
                    unselectedLabelColor: TpPalette.of(context).textSecondary,
                    labelStyle: Theme.of(context)
                        .textTheme
                        .labelMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                    tabs: <Widget>[
                      for (final AccidentCaseWorkspace workspace
                          in AccidentCaseWorkspace.values)
                        Tab(
                          height: 47,
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Icon(workspace.icon, size: TpSizing.iconSm),
                              const SizedBox(width: TpSpace.xs),
                              Text(
                                '${workspace.step} '
                                '${workflowCopy(workspace.labelKey)}',
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              )
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
      AccidentCaseScreenKeys.incident,
      AccidentCaseScreenKeys.fleet,
      AccidentCaseScreenKeys.responsibility,
      AccidentCaseScreenKeys.insurance,
      AccidentCaseScreenKeys.assessment,
      AccidentCaseScreenKeys.externalWorkshop,
      AccidentCaseScreenKeys.timeline,
    ];
    return TabBarView(
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
          ),
      ],
    );
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
