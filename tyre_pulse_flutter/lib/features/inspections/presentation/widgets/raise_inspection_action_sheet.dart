/// "Raise action" from ONE recorded inspection - always for that inspection's
/// own vehicle (the asset comes from the inspection row, never re-picked).
///
/// Mirrors `src/components/inspections/RaiseActionDialog.jsx`: per defect the
/// raiser can include/exclude it, write how it should be done, add a remark or
/// correction and set a due date; one person (searched by name, filtered by
/// role group) is assigned to every selected action. Online-only - see
/// `inspection_action_repository.dart`.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_action_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_action_plan.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';

/// Opens the sheet. Resolves to the result when something was raised.
Future<RaiseActionsResult?> showRaiseInspectionActionSheet(
  BuildContext context, {
  required ActionInspectionFacts inspection,
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return TpBottomSheet.show<RaiseActionsResult>(
    context: context,
    title: l10n.inspectionRaiseActionTitle(inspection.assetNo),
    builder: (BuildContext c) =>
        RaiseInspectionActionSheet(inspection: inspection),
  );
}

class RaiseInspectionActionSheet extends ConsumerStatefulWidget {
  const RaiseInspectionActionSheet({required this.inspection, super.key});

  final ActionInspectionFacts inspection;

  @override
  ConsumerState<RaiseInspectionActionSheet> createState() =>
      _RaiseInspectionActionSheetState();
}

class _RoleChip {
  const _RoleChip(this.label, this.roles);
  final String label;
  final List<String> roles;
}

class _RaiseInspectionActionSheetState
    extends ConsumerState<RaiseInspectionActionSheet> {
  late final List<ActionDefect> _defects =
      defectsForInspection(widget.inspection);
  final Map<String, ActionPlan> _plans = <String, ActionPlan>{};
  final Map<String, TextEditingController> _instruction =
      <String, TextEditingController>{};
  final Map<String, TextEditingController> _comment =
      <String, TextEditingController>{};

  Set<String>? _existing;
  Object? _existingError;
  bool _loadingExisting = true;

  int _chip = 0;
  final TextEditingController _search = TextEditingController();
  Timer? _debounce;
  List<AssignablePerson> _people = const <AssignablePerson>[];
  bool _loadingPeople = false;
  bool _peopleError = false;
  int _peopleGeneration = 0;
  AssignablePerson? _assignee;

  bool _submitting = false;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    final bool hasTyreDefect =
        _defects.any((ActionDefect d) => d.kind != 'finding');
    for (final ActionDefect d in _defects) {
      final ActionPlan base = defaultPlanFor(d);
      // The whole-inspection item is opt-in when there are tyre defects.
      _plans[d.key] = base.copyWith(
        include: d.kind != 'finding' || !hasTyreDefect,
      );
      _instruction[d.key] = TextEditingController(text: base.instruction);
      _comment[d.key] = TextEditingController();
    }
    unawaited(_loadExisting());
    unawaited(_loadPeople());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    for (final TextEditingController c in _instruction.values) {
      c.dispose();
    }
    for (final TextEditingController c in _comment.values) {
      c.dispose();
    }
    super.dispose();
  }

  List<_RoleChip> _chips(AppLocalizations l10n) => <_RoleChip>[
        _RoleChip(l10n.inspectionAssigneeTyreMen, AssigneeRoleGroups.tyreMen),
        _RoleChip(l10n.inspectionAssigneeDrivers, AssigneeRoleGroups.drivers),
        _RoleChip(
          l10n.inspectionAssigneeSupervisors,
          AssigneeRoleGroups.supervisors,
        ),
        _RoleChip(l10n.inspectionAssigneeEveryone, AssigneeRoleGroups.everyone),
      ];

  Future<void> _loadExisting() async {
    setState(() {
      _loadingExisting = true;
      _existingError = null;
    });
    try {
      final Set<String> keys = await ref
          .read(inspectionActionRepositoryProvider)
          .existingKeys(widget.inspection.id);
      if (!mounted) return;
      setState(() {
        _existing = keys;
        _loadingExisting = false;
      });
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _existingError = e;
        _loadingExisting = false;
      });
    }
  }

  Future<void> _loadPeople() async {
    final int generation = ++_peopleGeneration;
    final List<String> roles =
        _chips(AppLocalizations.of(context))[_chip].roles;
    setState(() {
      _loadingPeople = true;
      _peopleError = false;
    });
    try {
      final List<AssignablePerson> people = await ref
          .read(inspectionActionRepositoryProvider)
          .listAssignablePeople(search: _search.text, roles: roles);
      if (!mounted || generation != _peopleGeneration) return;
      setState(() {
        _people = people;
        _loadingPeople = false;
      });
    } on Object {
      if (!mounted || generation != _peopleGeneration) return;
      setState(() {
        _people = const <AssignablePerson>[];
        _peopleError = true;
        _loadingPeople = false;
      });
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) unawaited(_loadPeople());
    });
  }

  Future<void> _pickDate(ActionDefect d) async {
    final ActionPlan plan = _plans[d.key]!;
    final DateTime now = DateTime.now();
    final DateTime initial = DateTime.tryParse(plan.dueDate ?? '') ?? now;
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(now) ? now : initial,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 2),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _plans[d.key] = plan.copyWith(dueDate: addActionDays(picked, 0));
    });
  }

  List<ActionDefect> get _selectable => <ActionDefect>[
        for (final ActionDefect d in _defects)
          if (!(_existing?.contains(d.key) ?? false)) d,
      ];

  List<ActionDefect> get _chosen => <ActionDefect>[
        for (final ActionDefect d in _selectable)
          if (_plans[d.key]!.include) d,
      ];

  Future<void> _submit() async {
    if (_submitting) return; // double-tap guard
    final List<ActionDefect> chosen = _chosen;
    if (chosen.isEmpty) return;
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    final Map<String, ActionPlan> plans = <String, ActionPlan>{
      for (final ActionDefect d in chosen)
        d.key: _plans[d.key]!.copyWith(
          instruction: _instruction[d.key]!.text,
          comment: _comment[d.key]!.text,
          assigneeName: _assignee?.name,
        ),
    };
    final List<Map<String, Object?>> rows = actionRowsForInspection(
      widget.inspection,
      chosen,
      existingKeys: _existing ?? const <String>{},
      plans: plans,
    );
    try {
      final RaiseActionsResult result =
          await ref.read(inspectionActionRepositoryProvider).raise(
                inspectionId: widget.inspection.id,
                rows: rows,
                skippedUpFront: chosen.length - rows.length,
              );
      if (!mounted) return;
      if (result.created == 0 && result.failedMessages.isNotEmpty) {
        setState(() {
          _submitError = result.failedMessages.first;
          _submitting = false;
        });
        return;
      }
      Navigator.of(context).pop(result);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _submitError = e is SupabaseFailure
            ? e.error.message
            : AppLocalizations.of(context).inspectionRaiseActionFailed;
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    if (_loadingExisting) {
      return const SizedBox(height: 240, child: TpLoadingState());
    }
    if (_existingError != null) {
      final Object e = _existingError!;
      return SizedBox(
        height: 320,
        child: TpErrorState(
          error: e is SupabaseFailure
              ? e.error
              : AppError(
                  kind: AppErrorKind.unknown,
                  message: l10n.inspectionRaiseActionLoadFailed,
                  technical: 'RaiseInspectionActionSheet._loadExisting',
                  isRetryable: true,
                ),
          onRetry: _loadExisting,
        ),
      );
    }

    final List<ActionDefect> selectable = _selectable;
    final int alreadyRaised = _defects.length - selectable.length;
    final List<_RoleChip> chips = _chips(l10n);

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.85,
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          0,
          TpSpace.lg,
          TpSpace.lg,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              l10n.inspectionRaiseActionVehicle(widget.inspection.assetNo),
              style: text.bodySmall?.copyWith(color: palette.textMuted),
            ),
            if (alreadyRaised > 0)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  l10n.inspectionRaiseActionAlreadyRaised(alreadyRaised),
                  style: text.bodySmall?.copyWith(color: palette.textMuted),
                ),
              ),
            const SizedBox(height: TpSpace.md),
            if (selectable.isEmpty)
              TpEmptyState(
                title: l10n.inspectionRaiseActionNothingTitle,
                message: l10n.inspectionRaiseActionNothingMessage,
              )
            else ...<Widget>[
              for (final ActionDefect d in selectable) _defectCard(l10n, d),
              const SizedBox(height: TpSpace.md),
              Text(l10n.inspectionAssignToLabel, style: text.titleSmall),
              const SizedBox(height: TpSpace.xs),
              Text(
                _assignee == null
                    ? l10n.inspectionAssigneeNone
                    : '${_assignee!.name} (${_assignee!.role})',
                style: text.bodyMedium,
              ),
              const SizedBox(height: TpSpace.sm),
              Wrap(
                spacing: TpSpace.xs,
                runSpacing: TpSpace.xs,
                children: <Widget>[
                  for (int i = 0; i < chips.length; i++)
                    ChoiceChip(
                      label: Text(chips[i].label),
                      selected: _chip == i,
                      onSelected: (_) {
                        setState(() => _chip = i);
                        unawaited(_loadPeople());
                      },
                    ),
                ],
              ),
              const SizedBox(height: TpSpace.sm),
              TpSearchField(
                controller: _search,
                hint: l10n.inspectionAssigneeSearchHint,
                onChanged: _onSearch,
              ),
              const SizedBox(height: TpSpace.sm),
              _peopleList(l10n, palette),
              if (_submitError != null)
                Padding(
                  padding: const EdgeInsets.only(top: TpSpace.md),
                  child: Text(
                    _submitError!,
                    style: text.bodySmall?.copyWith(
                      color: palette.forStatus(TpStatus.critical).base,
                    ),
                  ),
                ),
              const SizedBox(height: TpSpace.lg),
              TpButton.primary(
                label: l10n.inspectionRaiseActionSubmit(_chosen.length),
                icon: Icons.assignment_turned_in_outlined,
                isFullWidth: true,
                isBusy: _submitting,
                onPressed: _submitting || _chosen.isEmpty
                    ? null
                    : () => unawaited(_submit()),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _peopleList(AppLocalizations l10n, TpPalette palette) {
    if (_loadingPeople) {
      return const Padding(
        padding: EdgeInsets.all(TpSpace.md),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    if (_peopleError) {
      return Row(
        children: <Widget>[
          Expanded(child: Text(l10n.inspectionAssigneeLoadFailed)),
          TpButton.text(
            label: l10n.inspectionRetrySyncButton,
            onPressed: () => unawaited(_loadPeople()),
          ),
        ],
      );
    }
    if (_people.isEmpty) {
      return Text(
        l10n.inspectionAssigneeNoMatch,
        style: TextStyle(color: palette.textMuted),
      );
    }
    return Column(
      children: <Widget>[
        for (final AssignablePerson p in _people.take(12))
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(p.name),
            subtitle: Text(
              <String>[p.role, if (p.site.isNotEmpty) p.site].join(' | '),
            ),
            trailing:
                _assignee?.id == p.id ? const Icon(Icons.check_circle) : null,
            onTap: () => setState(
              () => _assignee = _assignee?.id == p.id ? null : p,
            ),
          ),
      ],
    );
  }

  Widget _defectCard(AppLocalizations l10n, ActionDefect d) {
    final ActionPlan plan = _plans[d.key]!;
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: plan.include,
            onChanged: (bool? v) => setState(
              () => _plans[d.key] = plan.copyWith(include: v ?? false),
            ),
            title: Text(d.title, style: text.titleSmall),
            subtitle: Text(d.priority),
          ),
          if (plan.include) ...<Widget>[
            TpInput(
              label: l10n.inspectionActionInstructionLabel,
              controller: _instruction[d.key],
              maxLines: 3,
            ),
            const SizedBox(height: TpSpace.sm),
            TpInput(
              label: l10n.inspectionActionCommentLabel,
              hint: l10n.inspectionActionCommentHint,
              controller: _comment[d.key],
              maxLines: 2,
            ),
            const SizedBox(height: TpSpace.sm),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TpButton.secondary(
                label: l10n.inspectionActionDueDate(plan.dueDate ?? '-'),
                icon: Icons.event_outlined,
                onPressed: _submitting ? null : () => unawaited(_pickDate(d)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
