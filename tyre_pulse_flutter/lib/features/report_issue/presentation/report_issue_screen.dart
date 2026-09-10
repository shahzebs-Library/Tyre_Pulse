library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/selected_vehicle_card.dart';
import 'package:tyre_pulse/features/report_issue/data/report_issue_draft_store.dart';
import 'package:tyre_pulse/features/report_issue/data/report_issue_photo_capture.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_copy.dart';
import 'package:tyre_pulse/features/report_issue/report_issue_providers.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_defect_report_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/tyre_diagram_providers.dart';

class ReportIssueScreen extends ConsumerStatefulWidget {
  const ReportIssueScreen({required this.route, super.key});

  final ReportIssueRoute route;

  @override
  ConsumerState<ReportIssueScreen> createState() => _ReportIssueScreenState();
}

class _ReportIssueScreenState extends ConsumerState<ReportIssueScreen> {
  late final TextEditingController _title;
  late final TextEditingController _site;
  late final TextEditingController _asset;
  late final TextEditingController _details;
  late final TextEditingController _restriction;
  final List<String> _photos = <String>[];
  final String _sessionKey = DateTime.now().microsecondsSinceEpoch.toString();
  String _priority = CorrectiveActionPriority.medium;
  String _category = 'mechanical';
  String _operation = 'restricted';
  bool _requestWorkOrder = true;
  bool _draftSaved = false;
  bool _savingDraft = false;
  bool _restoringDraft = false;
  bool _saving = false;
  DateTime? _incidentAt = DateTime.now();

  @override
  void initState() {
    super.initState();
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    _title = TextEditingController();
    _site = TextEditingController(
      text: widget.route.siteName?.value ?? workspace?.legacySite ?? '',
    );
    _asset = TextEditingController(text: widget.route.assetNo?.value ?? '');
    _details = TextEditingController();
    _restriction = TextEditingController();
    for (final TextEditingController controller in <TextEditingController>[
      _title,
      _site,
      _asset,
      _details,
      _restriction,
    ]) {
      controller.addListener(_markDraftDirty);
    }
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => unawaited(_restoreDraft()),
    );
  }

  @override
  void dispose() {
    _title.dispose();
    _site.dispose();
    _asset.dispose();
    _details.dispose();
    _restriction.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ReportIssueCopy copy = ReportIssueCopy.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        backFallback: fallback,
        actions: <Widget>[
          if (_draftSaved)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: TpSpace.md),
              child: TpSyncLabel(label: copy('draftSaved')),
            ),
        ],
      ),
      bottomNavigationBar: TpBottomActionRail(
        secondaryLabel: copy('saveDraft'),
        primaryLabel: copy('submit'),
        onSecondary:
            _savingDraft || _saving ? null : () => unawaited(_saveDraft(copy)),
        onPrimary:
            _savingDraft || _saving ? null : () => unawaited(_submit(copy)),
        primaryBusy: _saving,
        secondaryKey: const Key('reportIssue.saveDraft'),
        primaryKey: const Key('reportIssue.submit'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                AnimatedBuilder(
                  animation: Listenable.merge(<Listenable>[_asset, _site]),
                  builder: (BuildContext context, Widget? child) {
                    if (_asset.text.trim().isEmpty &&
                        _site.text.trim().isEmpty) {
                      return const SizedBox.shrink();
                    }
                    return Padding(
                      padding: const EdgeInsets.only(bottom: TpSpace.lg),
                      child: _SelectedAssetSummary(
                        label: copy('asset'),
                        assetNo: _asset.text.trim(),
                        site: _site.text.trim(),
                      ),
                    );
                  },
                ),
                AnimatedBuilder(
                  animation: _asset,
                  builder: (context, child) => _AssetMasterSummary(
                    assetNo: _asset.text.trim(),
                  ),
                ),
                if (widget.route.assetNo == null) ...<Widget>[
                  TpButton.secondary(
                    key: const Key('reportIssue.scanAsset'),
                    label: l10n.checklistScanAssetAction,
                    icon: Icons.qr_code_scanner_rounded,
                    onPressed: _saving ? null : () => unawaited(_scanAsset()),
                  ),
                  const SizedBox(height: TpSpace.lg),
                ],
                OutlinedButton.icon(
                  key: const Key('reportIssue.incidentAt'),
                  icon: const Icon(Icons.event_outlined),
                  onPressed:
                      _saving ? null : () => unawaited(_pickIncidentAt()),
                  label: Text(
                    '${copy('incidentAt')}: ${_incidentAt == null ? copy('chooseDateTime') : _formatIncidentAt(_incidentAt!)}',
                  ),
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel(copy('category')),
                _IssueCategoryGrid(
                  selected: _category,
                  copy: copy,
                  onSelected: (String value) =>
                      _change(() => _category = value),
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel(copy('problem')),
                TextField(
                  key: const Key('reportIssue.title'),
                  controller: _title,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(hintText: copy('problemHint')),
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel(copy('priority')),
                _PriorityChoice(
                  value: _priority,
                  copy: copy,
                  onChanged: (String priority) =>
                      _change(() => _priority = priority),
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel(copy('operation')),
                _OperationChoice(
                  value: _operation,
                  copy: copy,
                  onChanged: (String value) =>
                      _change(() => _operation = value),
                ),
                if (_operation == 'restricted') ...<Widget>[
                  const SizedBox(height: TpSpace.md),
                  _LabeledInput(
                    label: copy('restriction'),
                    hint: copy('restriction'),
                    controller: _restriction,
                    keyName: 'restriction',
                  ),
                ],
                const SizedBox(height: TpSpace.lg),
                LayoutBuilder(
                  builder: (BuildContext context, BoxConstraints constraints) {
                    final bool stacked = constraints.maxWidth < 520;
                    final List<Widget> fields = <Widget>[
                      Expanded(
                        child: _LabeledInput(
                          label: copy('site'),
                          hint: copy('siteHint'),
                          controller: _site,
                          keyName: 'site',
                          readOnly: widget.route.siteName != null,
                        ),
                      ),
                      Expanded(
                        child: _LabeledInput(
                          label: copy('asset'),
                          hint: copy('assetHint'),
                          controller: _asset,
                          keyName: 'asset',
                          readOnly: widget.route.assetNo != null,
                        ),
                      ),
                    ];
                    if (!stacked) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          fields[0],
                          const SizedBox(width: TpSpace.md),
                          fields[1],
                        ],
                      );
                    }
                    return Column(
                      children: <Widget>[
                        _LabeledInput(
                          label: copy('site'),
                          hint: copy('siteHint'),
                          controller: _site,
                          keyName: 'site',
                          readOnly: widget.route.siteName != null,
                        ),
                        const SizedBox(height: TpSpace.lg),
                        _LabeledInput(
                          label: copy('asset'),
                          hint: copy('assetHint'),
                          controller: _asset,
                          keyName: 'asset',
                          readOnly: widget.route.assetNo != null,
                        ),
                      ],
                    );
                  },
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel('${copy('details')} ${copy('optional')}'),
                TextField(
                  key: const Key('reportIssue.details'),
                  controller: _details,
                  minLines: 4,
                  maxLines: 7,
                  decoration: InputDecoration(hintText: copy('detailsHint')),
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel('${copy('photos')} ${copy('optional')}'),
                const SizedBox(height: TpSpace.sm),
                _PhotoStrip(
                  photos: _photos,
                  addLabel: copy('addPhoto'),
                  onAdd: _photos.length >= ReportIssuePhotoCapture.maxPhotos
                      ? null
                      : () => unawaited(_choosePhotoSource(copy)),
                  onRemove: (int index) =>
                      _change(() => _photos.removeAt(index)),
                ),
                const SizedBox(height: TpSpace.lg),
                SwitchListTile.adaptive(
                  key: const Key('reportIssue.createWorkOrder'),
                  contentPadding: EdgeInsets.zero,
                  title: Text(copy('createWorkOrder')),
                  value: _requestWorkOrder,
                  onChanged: (bool value) =>
                      _change(() => _requestWorkOrder = value),
                ),
                TpCard(
                  padding: EdgeInsets.zero,
                  child: TpActionRow(
                    icon: Icons.groups_2_outlined,
                    label: copy('notifyTeam'),
                    showDivider: false,
                  ),
                ),
                const SizedBox(height: TpSpace.xxl),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _scanAsset() async {
    final workspace = ref.read(workspaceContextProvider);
    final assetNo = await showAssetCameraScanner(context);
    if (!mounted ||
        workspace != ref.read(workspaceContextProvider) ||
        assetNo == null ||
        assetNo.trim().isEmpty) {
      return;
    }
    _asset.text = assetNo.trim();
  }

  String _formatIncidentAt(DateTime value) {
    final local = value.toLocal();
    final material = MaterialLocalizations.of(context);
    return '${material.formatMediumDate(local)} ${material.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
  }

  Future<void> _pickIncidentAt() async {
    final now = DateTime.now();
    final initial = (_incidentAt ?? now).toLocal();
    final date = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? now : initial,
      firstDate: DateTime(2000),
      lastDate: now,
    );
    if (!mounted || date == null) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (!mounted || time == null) return;
    _change(
      () => _incidentAt = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      ),
    );
  }

  Future<void> _choosePhotoSource(ReportIssueCopy copy) async {
    final ReportIssuePhotoSource? source =
        await TpBottomSheet.show<ReportIssuePhotoSource>(
      context: context,
      title: copy('addPhoto'),
      builder: (BuildContext context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(copy('camera')),
              onTap: () =>
                  Navigator.pop(context, ReportIssuePhotoSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(copy('gallery')),
              onTap: () =>
                  Navigator.pop(context, ReportIssuePhotoSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    try {
      final String? path =
          await ref.read(reportIssuePhotoCaptureProvider).captureAndStore(
                sessionKey: _sessionKey,
                orderIndex: _photos.length,
                source: source,
              );
      if (path != null && mounted) {
        _change(() => _photos.add(path));
      }
    } on Object {
      if (mounted) _message(copy('photoFailed'));
    }
  }

  Future<void> _submit(ReportIssueCopy copy) async {
    if (_title.text.trim().isEmpty) {
      _message(copy('titleRequired'));
      return;
    }
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      _message(copy('workspaceUnavailable'));
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(tyreDefectReportRepositoryProvider).submitDefectReport(
            workspace: workspace,
            input: SubmitTyreDefectReportInput(
              title: _title.text,
              description: _submissionDescription(copy),
              assetNo: _asset.text,
              tyreSerial: widget.route.tyreSerial?.value,
              site: _site.text,
              priority: _priority,
              rootCause: _category,
              country: workspace.activeCountry,
              assignedTo: workspace.fullName,
              dueDate: null,
              photoLocalPaths: List<String>.unmodifiable(_photos),
            ),
          );
      final String? scope = _draftScope(workspace);
      if (scope != null) {
        try {
          await ref.read(reportIssueDraftStoreProvider).clear(scope);
        } on Object {
          // Submission is already safely queued. A stale local draft must not
          // misreport that successful operational write as a failed submit.
        }
      }
      if (!mounted) return;
      setState(() => _saving = false);
      await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
          title: Text(copy('savedTitle')),
          content: Text(copy('savedBody')),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(copy('stay')),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                context.go(const TasksRoute().location);
              },
              child: Text(copy('viewTasks')),
            ),
          ],
        ),
      );
    } on Object {
      if (mounted) _message(copy('saveFailed'));
    } finally {
      if (mounted && _saving) setState(() => _saving = false);
    }
  }

  String _submissionDescription(ReportIssueCopy copy) {
    final List<String> lines = <String>[
      _details.text.trim(),
      if (_incidentAt != null)
        '${copy('incidentAt')}: ${_incidentAt!.toUtc().toIso8601String()}',
      '${copy('operation')}: ${copy(_operation)}',
      if (_operation == 'restricted' && _restriction.text.trim().isNotEmpty)
        '${copy('restriction')}: ${_restriction.text.trim()}',
      if (_requestWorkOrder) copy('createWorkOrder'),
    ].where((String value) => value.isNotEmpty).toList(growable: false);
    return lines.join('\n');
  }

  void _markDraftDirty() {
    if (_restoringDraft || !mounted || !_draftSaved) return;
    setState(() => _draftSaved = false);
  }

  void _change(VoidCallback change) {
    setState(() {
      change();
      _draftSaved = false;
    });
  }

  String? _draftScope(WorkspaceContext? workspace) {
    if (workspace == null) return null;
    final String organisation =
        (workspace.tenantId ?? workspace.companyId ?? '').trim();
    if (organisation.isEmpty) return null;
    return <String>[
      organisation,
      workspace.activeCountry?.trim() ?? '',
      workspace.userId.trim(),
    ].join('|');
  }

  Future<void> _restoreDraft() async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? scope = _draftScope(workspace);
    if (scope == null) return;
    try {
      final ReportIssueDraft? draft =
          await ref.read(reportIssueDraftStoreProvider).load(scope);
      if (draft == null || !mounted) return;
      _restoringDraft = true;
      _title.text = draft.title;
      if (_site.text.trim().isEmpty) _site.text = draft.site;
      if (_asset.text.trim().isEmpty) _asset.text = draft.assetNo;
      _details.text = draft.description;
      _restriction.text = draft.restriction;
      _photos
        ..clear()
        ..addAll(
          draft.photoLocalPaths.where((String path) => File(path).existsSync()),
        );
      setState(() {
        _priority = CorrectiveActionPriority.all.contains(draft.priority)
            ? draft.priority
            : CorrectiveActionPriority.medium;
        _category = <String>{
          'mechanical',
          'electrical',
          'hydraulic',
          'tyre',
          'body',
          'washing',
          'safety',
          'other',
        }.contains(draft.category)
            ? draft.category
            : 'mechanical';
        _operation =
            <String>{'yes', 'restricted', 'no'}.contains(draft.operation)
                ? draft.operation
                : 'restricted';
        _requestWorkOrder = draft.requestWorkOrder;
        _incidentAt = draft.incidentAt;
        _draftSaved = true;
      });
    } on Object {
      // A damaged or unavailable device draft never blocks a new report.
    } finally {
      _restoringDraft = false;
    }
  }

  Future<void> _saveDraft(ReportIssueCopy copy) async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? scope = _draftScope(workspace);
    if (scope == null) {
      _message(copy('workspaceUnavailable'));
      return;
    }
    setState(() => _savingDraft = true);
    try {
      await ref.read(reportIssueDraftStoreProvider).save(
            scope,
            ReportIssueDraft(
              title: _title.text,
              site: _site.text,
              assetNo: _asset.text,
              description: _details.text,
              restriction: _restriction.text,
              priority: _priority,
              category: _category,
              operation: _operation,
              requestWorkOrder: _requestWorkOrder,
              photoLocalPaths: List<String>.unmodifiable(_photos),
              savedAt: DateTime.now(),
              incidentAt: _incidentAt,
            ),
          );
      if (!mounted) return;
      setState(() => _draftSaved = true);
      _message(copy('draftSaved'));
    } on Object {
      if (mounted) _message(copy('saveFailed'));
    } finally {
      if (mounted) setState(() => _savingDraft = false);
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(value)));
  }
}

class _AssetMasterSummary extends ConsumerWidget {
  const _AssetMasterSummary({required this.assetNo});

  final String assetNo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (assetNo.isEmpty || ref.watch(workspaceContextProvider) == null) {
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context);
    final detail = ref.watch(vehicleDetailProvider(assetNo));
    final outcome = detail.asData?.value;
    final VehicleAsset? asset = switch (outcome) {
      VehicleDetailLoaded(:final asset) => asset,
      VehicleDetailFromCache(:final asset) => asset,
      _ => null,
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.lg),
      child: asset == null
          ? detail.isLoading
              ? const LinearProgressIndicator()
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      outcome is VehicleDetailNotFound
                          ? l10n.vehiclesNotFoundMessage
                          : ReportIssueCopy.of(context)('assetLoadFailed'),
                    ),
                    TextButton(
                      onPressed: () =>
                          ref.invalidate(vehicleDetailProvider(assetNo)),
                      child: Text(l10n.actionRetry),
                    ),
                  ],
                )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SelectedVehicleCard(
                  asset: asset,
                  changeLabel: l10n.actionRetry,
                  unavailableLabel: l10n.valueUnavailable,
                  onChange: () =>
                      ref.invalidate(vehicleDetailProvider(assetNo)),
                ),
                if (outcome is VehicleDetailFromCache)
                  Text(l10n.stateOfflineCachedMessage),
              ],
            ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: TpSpace.sm),
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: TpPalette.of(context).textSecondary,
                fontWeight: FontWeight.w600,
                height: 16 / 12,
                letterSpacing: 0.2,
              ),
        ),
      );
}

class _IssueCategoryGrid extends StatelessWidget {
  const _IssueCategoryGrid({
    required this.selected,
    required this.copy,
    required this.onSelected,
  });

  final String selected;
  final ReportIssueCopy copy;
  final ValueChanged<String> onSelected;

  static const List<(String, IconData)> _items = <(String, IconData)>[
    ('mechanical', Icons.build_outlined),
    ('electrical', Icons.bolt_outlined),
    ('hydraulic', Icons.water_drop_outlined),
    ('tyre', Icons.tire_repair_outlined),
    ('body', Icons.directions_car_outlined),
    ('washing', Icons.water_outlined),
    ('safety', Icons.shield_outlined),
    ('other', Icons.more_horiz_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 360 ? 4 : 2;
        final double width =
            (constraints.maxWidth - TpSpace.sm * (columns - 1)) / columns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final (String key, IconData icon) in _items)
              SizedBox(
                width: width,
                child: Semantics(
                  selected: selected == key,
                  button: true,
                  child: InkWell(
                    onTap: () => onSelected(key),
                    borderRadius: BorderRadius.circular(TpRadius.md),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 140),
                      constraints: const BoxConstraints(minHeight: 64),
                      padding: const EdgeInsets.symmetric(
                        horizontal: TpSpace.sm,
                        vertical: TpSpace.md,
                      ),
                      decoration: BoxDecoration(
                        color: selected == key
                            ? palette.primarySoft
                            : palette.surface,
                        border: Border.all(
                          color: selected == key
                              ? palette.primary
                              : palette.borderStrong,
                          width: selected == key ? 2 : 1,
                        ),
                        borderRadius: BorderRadius.circular(TpRadius.md),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          Icon(icon, color: palette.primary, size: 25),
                          const SizedBox(height: 5),
                          Flexible(
                            child: Text(
                              copy(key),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.center,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelSmall
                                  ?.copyWith(color: palette.text),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _PriorityChoice extends StatelessWidget {
  const _PriorityChoice({
    required this.value,
    required this.copy,
    required this.onChanged,
  });

  final String value;
  final ReportIssueCopy copy;
  final ValueChanged<String> onChanged;

  static const List<(String, IconData, TpStatus)> _items =
      <(String, IconData, TpStatus)>[
    (CorrectiveActionPriority.low, Icons.arrow_downward_rounded, TpStatus.ok),
    (CorrectiveActionPriority.medium, Icons.remove_rounded, TpStatus.warning),
    (
      CorrectiveActionPriority.high,
      Icons.priority_high_rounded,
      TpStatus.warning
    ),
    (
      CorrectiveActionPriority.critical,
      Icons.priority_high_rounded,
      TpStatus.critical
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        for (int index = 0; index < _items.length; index++) ...<Widget>[
          if (index > 0) const SizedBox(width: 2),
          Expanded(
            child: InkWell(
              key: Key('reportIssue.priority.${_items[index].$1}'),
              onTap: () => onChanged(_items[index].$1),
              borderRadius: BorderRadius.circular(TpRadius.md),
              child: Container(
                constraints: const BoxConstraints(minHeight: 58),
                padding: const EdgeInsets.symmetric(horizontal: 3),
                decoration: BoxDecoration(
                  color: value == _items[index].$1
                      ? palette.forStatus(_items[index].$3).soft
                      : palette.surface,
                  border: Border.all(
                    color: value == _items[index].$1
                        ? palette.forStatus(_items[index].$3).base
                        : palette.borderStrong,
                  ),
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(
                      _items[index].$2,
                      size: 21,
                      color: palette.forStatus(_items[index].$3).base,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      copy(_items[index].$1.toLowerCase()),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.forStatus(_items[index].$3).base,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _OperationChoice extends StatelessWidget {
  const _OperationChoice({
    required this.value,
    required this.copy,
    required this.onChanged,
  });

  final String value;
  final ReportIssueCopy copy;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    const List<(String, IconData, TpStatus)> options =
        <(String, IconData, TpStatus)>[
      ('yes', Icons.check_circle_outline, TpStatus.ok),
      ('restricted', Icons.remove_circle_outline, TpStatus.warning),
      ('no', Icons.cancel_outlined, TpStatus.critical),
    ];
    return Row(
      children: <Widget>[
        for (int index = 0; index < options.length; index++) ...<Widget>[
          if (index > 0) const SizedBox(width: TpSpace.xs),
          Expanded(
            child: InkWell(
              onTap: () => onChanged(options[index].$1),
              borderRadius: BorderRadius.circular(TpRadius.md),
              child: Container(
                constraints: const BoxConstraints(minHeight: 58),
                padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
                decoration: BoxDecoration(
                  color: value == options[index].$1
                      ? palette.forStatus(options[index].$3).soft
                      : palette.surface,
                  border: Border.all(
                    color: value == options[index].$1
                        ? palette.forStatus(options[index].$3).base
                        : palette.borderStrong,
                  ),
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(
                      options[index].$2,
                      size: 20,
                      color: palette.forStatus(options[index].$3).base,
                    ),
                    const SizedBox(width: 5),
                    Flexible(
                      child: Text(
                        copy(options[index].$1),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _SelectedAssetSummary extends StatelessWidget {
  const _SelectedAssetSummary({
    required this.label,
    required this.assetNo,
    required this.site,
  });

  final String label;
  final String assetNo;
  final String site;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.directions_car_filled_outlined,
                size: 20,
                color: palette.primary,
              ),
              const SizedBox(width: TpSpace.sm),
              Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: palette.textMuted,
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const Spacer(),
              Icon(
                Icons.lock_outline_rounded,
                size: 17,
                color: palette.textMuted,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          if (assetNo.isNotEmpty)
            Text(
              assetNo,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w700,
                    height: 22 / 16,
                  ),
            ),
          if (site.isNotEmpty) ...<Widget>[
            const SizedBox(height: 2),
            Text(
              site,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: palette.textMuted,
                    fontWeight: FontWeight.w600,
                    height: 16 / 12,
                    letterSpacing: 0.2,
                  ),
            ),
          ],
        ],
      ),
    );
  }
}

class _LabeledInput extends StatelessWidget {
  const _LabeledInput({
    required this.label,
    required this.hint,
    required this.controller,
    required this.keyName,
    this.readOnly = false,
  });

  final String label;
  final String hint;
  final TextEditingController controller;
  final String keyName;
  final bool readOnly;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _FieldLabel(label),
          TextField(
            key: Key('reportIssue.$keyName'),
            controller: controller,
            readOnly: readOnly,
            decoration: InputDecoration(
              hintText: hint,
              suffixIcon: readOnly
                  ? const Icon(Icons.lock_outline_rounded, size: 18)
                  : null,
            ),
          ),
        ],
      );
}

class _PhotoStrip extends StatelessWidget {
  const _PhotoStrip({
    required this.photos,
    required this.addLabel,
    required this.onAdd,
    required this.onRemove,
  });

  final List<String> photos;
  final String addLabel;
  final VoidCallback? onAdd;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Material(
          color: palette.surfaceAlt,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            key: const Key('reportIssue.addPhoto'),
            onTap: onAdd,
            borderRadius: BorderRadius.circular(14),
            child: CustomPaint(
              painter: _UploadBorderPainter(
                color: onAdd == null ? palette.border : palette.borderStrong,
              ),
              child: SizedBox(
                height: 132,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(
                      Icons.add_rounded,
                      color:
                          onAdd == null ? palette.textMuted : palette.primary,
                      size: 32,
                    ),
                    const SizedBox(height: TpSpace.sm),
                    Text(
                      addLabel,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: palette.text,
                            fontWeight: FontWeight.w700,
                            height: 22 / 16,
                          ),
                    ),
                    const SizedBox(height: TpSpace.sm),
                    Text(
                      '${photos.length}/${ReportIssuePhotoCapture.maxPhotos}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: palette.textMuted,
                            fontWeight: FontWeight.w600,
                            height: 16 / 12,
                            letterSpacing: 0.2,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (photos.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              for (int i = 0; i < photos.length; i++)
                Stack(
                  children: <Widget>[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(TpRadius.sm),
                      child: Image.file(
                        File(photos[i]),
                        width: 88,
                        height: 88,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          width: 88,
                          height: 88,
                          color: palette.surfaceSunken,
                          child: const Icon(Icons.broken_image_outlined),
                        ),
                      ),
                    ),
                    PositionedDirectional(
                      top: 2,
                      end: 2,
                      child: IconButton.filled(
                        visualDensity: VisualDensity.compact,
                        iconSize: 16,
                        onPressed: () => onRemove(i),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _UploadBorderPainter extends CustomPainter {
  const _UploadBorderPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final Path path = Path()
      ..addRRect(
        RRect.fromRectAndRadius(
          Offset.zero & size,
          const Radius.circular(14),
        ),
      );
    for (final metric in path.computeMetrics()) {
      double distance = 0;
      while (distance < metric.length) {
        final double end = (distance + 6).clamp(0.0, metric.length).toDouble();
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance = end + 4;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _UploadBorderPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}
