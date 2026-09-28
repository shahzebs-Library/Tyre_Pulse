/// The Take Action screen - everything a field worker can do about one
/// wheel, reached from [TyreDetailScreen]'s primary button.
///
/// Pushed with a plain [Navigator.push], for the same reason
/// `tyre_detail_screen.dart`'s own library comment gives - no independent
/// route identity, so no edit to `routes.dart`/`app_router.dart` is needed.
///
/// # Every row is either real, or honestly disabled - never a live control
/// # that does nothing
///
/// Repository rule 7: "Never implement a control that does nothing." Two
/// rows are unconditionally real, backed by this app's own already-verified
/// write paths:
///
///  - **Replace tyre** - navigates to [TyreChangeRoute]
///    (`features/tyre_exchange/presentation/tyre_replacement_screen.dart`),
///    the app's existing, fully-built tyre-change flow. This screen does
///    not duplicate that form; it only pre-fills the asset/site/position
///    the caller already knows.
///  - **Repair (Puncture / Damage)** - opens a short form that queues
///    [CommandType.reportIssue] via [TyreDefectReportRepository], the same
///    already-registered command
///    `corrective_actions_test`/`command_registry_test.dart` pin.
///
/// One row is CONDITIONALLY real: **Adjust reading** only appears
/// enabled when [onAdjustReading] is supplied, which happens only when this
/// screen was reached from a LIVE, editable inspection draft - see
/// `new_inspection_screen.dart`'s own wiring. Read-only contexts (an
/// already-submitted inspection, an approval review) pass `null`, and the
/// row renders disabled with a caption explaining why, per [TpButton]'s own
/// documented idiom: "A disabled button is honest; a button that does
/// nothing when pressed is what repository rule 7 forbids."
///
/// **Rotate tyre** is real and online: it records one `rotation` row in
/// `tyre_service_events` through [TyreServiceEventRepository] (see that
/// file for the verified table, CHECK vocabulary and INSERT policy). It is
/// only offered when the screen knows a tyre serial or an asset number,
/// the same requirement the web's own writer enforces. It records the move
/// in the tyre's service history; it does not rewrite the register's
/// position, and the confirmation says so.
///
/// Three actions from the reference design are deliberately NOT shown,
/// because nothing real backs them for a field user, and a disabled
/// "coming soon" row is not an action:
///
///  - **Remove tyre** - a removal without a replacement is an UPDATE of the
///    existing `tyre_records` row. No offline command updates that table,
///    its UPDATE policy is managers only, and `tyre_service_events` has no
///    removal event type. A removal that is really a replacement is already
///    the Replace tyre row.
///  - **Send to retread** - no retread event type exists in
///    `tyre_service_events`, and `retread_claims` records a claim, not a
///    dispatch. Filing it under `other` would hide it from every report.
///  - **Mark as spare** - the only spare register is `tyre_pool`, whose
///    INSERT policy admits Admin/Manager/Director only and which would
///    contradict a tyre the register still shows fitted to this wheel.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_defect_report_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_service_event_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/tyre_diagram_providers.dart';

/// Pushes [TyreTakeActionScreen]. See [pushTyreDetailScreen]'s own doc
/// comment for why this is an imperative push rather than a named route.
Future<void> pushTyreTakeActionScreen(
  BuildContext context, {
  required String positionCode,
  String? assetNo,
  String? siteName,
  String? tyreSerial,
  VoidCallback? onAdjustReading,
}) {
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (BuildContext context) => TyreTakeActionScreen(
        positionCode: positionCode,
        assetNo: assetNo,
        siteName: siteName,
        tyreSerial: tyreSerial,
        onAdjustReading: onAdjustReading,
      ),
    ),
  );
}

class TyreTakeActionScreen extends ConsumerWidget {
  const TyreTakeActionScreen({
    required this.positionCode,
    this.assetNo,
    this.siteName,
    this.tyreSerial,
    this.onAdjustReading,
    super.key,
  });

  final String positionCode;
  final String? assetNo;
  final String? siteName;
  final String? tyreSerial;
  final VoidCallback? onAdjustReading;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.takeActionTitle,
        subtitle: positionCode,
        onBack: () => Navigator.of(context).pop(),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _ActionTile(
            icon: Icons.sync_alt,
            title: l10n.takeActionReplaceTyre,
            subtitle: l10n.takeActionReplaceTyreSubtitle,
            onTap: () => _replaceTyre(context),
          ),
          _ActionTile(
            icon: Icons.report_problem_outlined,
            title: l10n.takeActionReportDefect,
            subtitle: l10n.takeActionReportDefectSubtitle,
            onTap: () => _reportDefect(context, ref),
          ),
          _ActionTile(
            icon: Icons.speed_outlined,
            title: l10n.takeActionAdjustReading,
            subtitle: onAdjustReading != null
                ? l10n.takeActionAdjustReadingSubtitle
                : l10n.takeActionAdjustReadingUnavailableCaption,
            onTap: onAdjustReading,
          ),
          if (_canRotate)
            _ActionTile(
              icon: Icons.rotate_right_outlined,
              title: l10n.takeActionRotateTyre,
              subtitle: l10n.tyreActionRotateSubtitle,
              onTap: () => _rotateTyre(context),
            ),
        ],
      ),
    );
  }

  void _replaceTyre(BuildContext context) {
    context.push(
      TyreChangeRoute(
        assetNo: _blankToNull(assetNo) == null ? null : AssetNo(assetNo!),
        siteName: _blankToNull(siteName) == null ? null : SiteName(siteName!),
        tyrePosition: _blankToNull(positionCode) == null
            ? null
            : TyrePosition(positionCode),
      ).location,
    );
  }

  Future<void> _reportDefect(BuildContext context, WidgetRef ref) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    await TpBottomSheet.show<void>(
      context: context,
      title: l10n.reportDefectTitle,
      builder: (BuildContext sheetContext) => _ReportDefectForm(
        positionCode: positionCode,
        assetNo: assetNo,
        siteName: siteName,
        tyreSerial: tyreSerial,
      ),
    );
  }

  /// A rotation event must name a tyre serial or an asset - see
  /// [TyreServiceEventRepository.recordRotation].
  bool get _canRotate =>
      _blankToNull(tyreSerial) != null || _blankToNull(assetNo) != null;

  Future<void> _rotateTyre(BuildContext context) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    await TpBottomSheet.show<void>(
      context: context,
      title: l10n.takeActionRotateTyre,
      builder: (BuildContext sheetContext) => _RotateTyreForm(
        positionCode: positionCode,
        assetNo: assetNo,
        siteName: siteName,
        tyreSerial: tyreSerial,
      ),
    );
  }

  static String? _blankToNull(String? value) {
    final String trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool isEnabled = onTap != null;
    final Color foreground = isEnabled ? palette.text : palette.textMuted;

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
        child: Row(
          children: <Widget>[
            DecoratedBox(
              decoration: BoxDecoration(
                color: isEnabled ? palette.primarySoft : palette.surfaceAlt,
                shape: BoxShape.circle,
              ),
              child: Padding(
                padding: const EdgeInsets.all(TpSpace.sm),
                child: Icon(
                  icon,
                  size: TpSizing.iconMd,
                  color: isEnabled ? palette.primaryDark : palette.textMuted,
                ),
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    title,
                    style: Theme.of(
                      context,
                    ).textTheme.titleSmall?.copyWith(color: foreground),
                  ),
                  Text(
                    subtitle,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: palette.textMuted,
                        ),
                  ),
                ],
              ),
            ),
            if (isEnabled) Icon(Icons.chevron_right, color: palette.textMuted),
          ],
        ),
      ),
    );
  }
}

class _ReportDefectForm extends ConsumerStatefulWidget {
  const _ReportDefectForm({
    required this.positionCode,
    this.assetNo,
    this.siteName,
    this.tyreSerial,
  });

  final String positionCode;
  final String? assetNo;
  final String? siteName;
  final String? tyreSerial;

  @override
  ConsumerState<_ReportDefectForm> createState() => _ReportDefectFormState();
}

class _ReportDefectFormState extends ConsumerState<_ReportDefectForm> {
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();
  String? _priority = CorrectiveActionPriority.medium;
  String? _damageReason;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _titleController.text = widget.assetNo == null || widget.assetNo!.isEmpty
        ? widget.positionCode
        : '${widget.assetNo} ${widget.positionCode}';
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  List<TpDropdownItem<String>> _damageReasonItems(AppLocalizations l10n) {
    return <TpDropdownItem<String>>[
      TpDropdownItem<String>(
        value: l10n.damageReasonPuncture,
        label: l10n.damageReasonPuncture,
      ),
      TpDropdownItem<String>(
        value: l10n.damageReasonSidewall,
        label: l10n.damageReasonSidewall,
      ),
      TpDropdownItem<String>(
        value: l10n.damageReasonTreadWear,
        label: l10n.damageReasonTreadWear,
      ),
      TpDropdownItem<String>(
        value: l10n.damageReasonBlowout,
        label: l10n.damageReasonBlowout,
      ),
      TpDropdownItem<String>(
        value: l10n.damageReasonImpact,
        label: l10n.damageReasonImpact,
      ),
      TpDropdownItem<String>(
        value: l10n.damageReasonOther,
        label: l10n.damageReasonOther,
      ),
    ];
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String title = _titleController.text.trim();
    if (title.isEmpty) {
      await _showInfo(
        title: l10n.reportDefectTitleRequiredTitle,
        message: l10n.reportDefectTitleRequiredMessage,
      );
      return;
    }

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    setState(() => _submitting = true);
    try {
      await ref.read(tyreDefectReportRepositoryProvider).submitDefectReport(
            workspace: workspace,
            input: SubmitTyreDefectReportInput(
              title: title,
              description: _descriptionController.text.trim().isEmpty
                  ? '${widget.positionCode}: $title'
                  : _descriptionController.text.trim(),
              assetNo: widget.assetNo,
              tyreSerial: widget.tyreSerial,
              site: widget.siteName,
              priority: _priority,
              rootCause: _damageReason,
              country: workspace.activeCountry,
            ),
          );
      if (!mounted) return;
      await _showInfo(
        title: l10n.reportDefectSavedTitle,
        message: l10n.reportDefectSavedMessage,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
    } on Object {
      if (!mounted) return;
      await _showInfo(
        title: l10n.reportDefectSaveFailedTitle,
        message: l10n.tyreReplaceTryAgainFallback,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _showInfo({required String title, required String message}) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          TpInput(
            label: l10n.reportDefectTitleFieldLabel,
            controller: _titleController,
            hint: l10n.reportDefectTitleFieldHint,
            isRequired: true,
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: l10n.reportDefectDescriptionLabel,
            controller: _descriptionController,
            hint: l10n.reportDefectDescriptionHint,
            maxLines: 3,
          ),
          const SizedBox(height: TpSpace.md),
          TpDropdown<String>(
            label: l10n.reportDefectDamageReasonLabel,
            hint: l10n.reportDefectDamageReasonHint,
            value: _damageReason,
            items: _damageReasonItems(l10n),
            onChanged: (String? v) => setState(() => _damageReason = v),
          ),
          const SizedBox(height: TpSpace.md),
          TpDropdown<String>(
            label: l10n.reportDefectPriorityLabel,
            value: _priority,
            items: <TpDropdownItem<String>>[
              for (final String p in CorrectiveActionPriority.all)
                TpDropdownItem<String>(value: p, label: p),
            ],
            onChanged: (String? v) => setState(() => _priority = v),
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.reportDefectSubmitAction,
            icon: Icons.save_outlined,
            isFullWidth: true,
            isBusy: _submitting,
            onPressed: _submitting ? null : _submit,
          ),
        ],
      ),
    );
  }
}

class _RotateTyreForm extends ConsumerStatefulWidget {
  const _RotateTyreForm({
    required this.positionCode,
    this.assetNo,
    this.siteName,
    this.tyreSerial,
  });

  final String positionCode;
  final String? assetNo;
  final String? siteName;
  final String? tyreSerial;

  @override
  ConsumerState<_RotateTyreForm> createState() => _RotateTyreFormState();
}

class _RotateTyreFormState extends ConsumerState<_RotateTyreForm> {
  late final TextEditingController _fromController =
      TextEditingController(text: widget.positionCode);
  final TextEditingController _toController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _fromController.dispose();
    _toController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String to = _toController.text.trim();
    if (to.isEmpty) {
      await _showInfo(
        title: l10n.tyreActionRotateToRequiredTitle,
        message: l10n.tyreActionRotateToRequiredMessage,
      );
      return;
    }
    if (to.toUpperCase() == widget.positionCode.trim().toUpperCase()) {
      await _showInfo(
        title: l10n.tyreActionRotateToRequiredTitle,
        message: l10n.tyreActionRotateSamePositionMessage,
      );
      return;
    }

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    setState(() => _submitting = true);
    try {
      await ref.read(tyreServiceEventRepositoryProvider).recordRotation(
            workspace: workspace,
            input: RecordTyreRotationInput(
              fromPosition: widget.positionCode,
              toPosition: to,
              eventDate: DateTime.now(),
              assetNo: widget.assetNo,
              tyreSerial: widget.tyreSerial,
              site: widget.siteName,
              notes: _notesController.text,
            ),
          );
      if (!mounted) return;
      await _showInfo(
        title: l10n.tyreActionRotateSavedTitle,
        message: l10n.tyreActionRotateSavedMessage,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
    } on Object catch (error) {
      if (!mounted) return;
      await _showInfo(
        title: l10n.tyreActionRotateFailedTitle,
        message: _isNetwork(error)
            ? l10n.tyreActionRotateOfflineMessage
            : l10n.tyreActionRotateFailedMessage,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// The repository's writes go through `SupabaseGateway.guard`, which
  /// throws a [SupabaseFailure] wrapping the classified [AppError].
  static bool _isNetwork(Object error) {
    final AppErrorKind? kind = switch (error) {
      SupabaseFailure(:final AppError error) => error.kind,
      AppError(:final AppErrorKind kind) => kind,
      _ => null,
    };
    return kind == AppErrorKind.network;
  }

  Future<void> _showInfo({required String title, required String message}) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          TpInput(
            label: l10n.tyreActionRotateFromLabel,
            controller: _fromController,
            enabled: false,
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: l10n.tyreActionRotateToLabel,
            controller: _toController,
            hint: l10n.tyreActionRotateToHint,
            isRequired: true,
            textCapitalization: TextCapitalization.characters,
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: l10n.tyreActionRotateNotesLabel,
            controller: _notesController,
            hint: l10n.tyreActionRotateNotesHint,
            maxLines: 3,
            helperText: l10n.tyreActionRotateOnlineNote,
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.tyreActionRotateSubmit,
            icon: Icons.save_outlined,
            isFullWidth: true,
            isBusy: _submitting,
            onPressed: _submitting ? null : _submit,
          ),
        ],
      ),
    );
  }
}
