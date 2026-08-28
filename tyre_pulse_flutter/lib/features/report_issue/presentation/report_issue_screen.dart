library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/report_issue/data/report_issue_photo_capture.dart';
import 'package:tyre_pulse/features/report_issue/presentation/report_issue_copy.dart';
import 'package:tyre_pulse/features/report_issue/report_issue_providers.dart';
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
  final List<String> _photos = <String>[];
  final String _sessionKey = DateTime.now().microsecondsSinceEpoch.toString();
  String _priority = CorrectiveActionPriority.medium;
  int? _dueDays = 7;
  bool _saving = false;

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
  }

  @override
  void dispose() {
    _title.dispose();
    _site.dispose();
    _asset.dispose();
    _details.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ReportIssueCopy copy = ReportIssueCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        backFallback: fallback,
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
                _FieldLabel(copy('problem')),
                TextField(
                  key: const Key('reportIssue.title'),
                  controller: _title,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(hintText: copy('problemHint')),
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel(copy('priority')),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.sm,
                  children: <Widget>[
                    for (final String priority in CorrectiveActionPriority.all)
                      ChoiceChip(
                        key: Key('reportIssue.priority.$priority'),
                        label: Text(copy(priority.toLowerCase())),
                        selected: _priority == priority,
                        onSelected: (_) => setState(() => _priority = priority),
                      ),
                  ],
                ),
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
                        ),
                      ),
                      Expanded(
                        child: _LabeledInput(
                          label: copy('asset'),
                          hint: copy('assetHint'),
                          controller: _asset,
                          keyName: 'asset',
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
                        ),
                        const SizedBox(height: TpSpace.lg),
                        _LabeledInput(
                          label: copy('asset'),
                          hint: copy('assetHint'),
                          controller: _asset,
                          keyName: 'asset',
                        ),
                      ],
                    );
                  },
                ),
                const SizedBox(height: TpSpace.lg),
                _FieldLabel(copy('due')),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.sm,
                  children: <Widget>[
                    for (final ({int? days, String key}) option
                        in const <({int? days, String key})>[
                      (days: null, key: 'noDate'),
                      (days: 3, key: 'threeDays'),
                      (days: 7, key: 'oneWeek'),
                      (days: 14, key: 'twoWeeks'),
                    ])
                      ChoiceChip(
                        key: Key('reportIssue.due.${option.days}'),
                        label: Text(copy(option.key)),
                        selected: _dueDays == option.days,
                        onSelected: (_) =>
                            setState(() => _dueDays = option.days),
                      ),
                  ],
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
                      setState(() => _photos.removeAt(index)),
                ),
                const SizedBox(height: TpSpace.xxl),
                FilledButton.icon(
                  key: const Key('reportIssue.submit'),
                  onPressed: _saving ? null : () => unawaited(_submit(copy)),
                  icon: _saving
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send_rounded),
                  label: Text(copy('submit')),
                ),
              ],
            ),
          ),
        ),
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
      if (path != null && mounted) setState(() => _photos.add(path));
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
              description: _details.text,
              assetNo: _asset.text,
              tyreSerial: widget.route.tyreSerial?.value,
              site: _site.text,
              priority: _priority,
              country: workspace.activeCountry,
              assignedTo: workspace.fullName,
              dueDate: _dueDays == null
                  ? null
                  : DateTime.now().add(Duration(days: _dueDays!)),
              photoLocalPaths: List<String>.unmodifiable(_photos),
            ),
          );
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

  void _message(String value) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(value)));
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
          style: Theme.of(context)
              .textTheme
              .labelLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
      );
}

class _LabeledInput extends StatelessWidget {
  const _LabeledInput({
    required this.label,
    required this.hint,
    required this.controller,
    required this.keyName,
  });

  final String label;
  final String hint;
  final TextEditingController controller;
  final String keyName;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _FieldLabel(label),
          TextField(
            key: Key('reportIssue.$keyName'),
            controller: controller,
            decoration: InputDecoration(hintText: hint),
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
    return Wrap(
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
        if (onAdd != null)
          OutlinedButton.icon(
            key: const Key('reportIssue.addPhoto'),
            onPressed: onAdd,
            icon: const Icon(Icons.add_a_photo_outlined),
            label: Text(addLabel),
          ),
      ],
    );
  }
}
