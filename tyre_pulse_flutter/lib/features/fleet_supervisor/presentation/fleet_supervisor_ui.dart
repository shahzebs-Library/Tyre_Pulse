/// Small shared pieces for the Fleet Supervisor screens.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/fleet_supervisor/data/fleet_team_repository.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_copy.dart';

/// `YYYY-MM-DD` in the device zone.
String fleetDate(DateTime? d) {
  if (d == null) return '';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)}';
}

/// `12,345` without a locale dependency (identifiers and km stay Latin digits
/// in every language, like the rest of the app).
String fleetKm(double km) {
  final String whole = km.round().toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) out.write(',');
    out.write(whole[i]);
  }
  return out.toString();
}

/// The sentence to show for a failed call. A server sentence (22023 guard) is
/// shown as the server wrote it; offline has its own plain wording.
String fleetErrorText(FleetSupervisorCopy copy, Object error) {
  if (error is FleetOfflineFailure) return copy('offline');
  if (error is AppError) {
    if (error.kind == AppErrorKind.network) return copy('offline');
    return error.message;
  }
  return copy('loadFailed');
}

AppError fleetAsAppError(FleetSupervisorCopy copy, Object error) {
  if (error is AppError) return error;
  if (error is FleetOfflineFailure) {
    return AppError.network(cause: error);
  }
  return AppError(
    kind: AppErrorKind.unknown,
    message: copy('loadFailed'),
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

void fleetSnack(BuildContext context, String message) {
  ScaffoldMessenger.maybeOf(context)
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Asks for the reason every assignment row keeps. Returns null on cancel.
Future<String?> askFleetReason(
  BuildContext context, {
  required String title,
  String? message,
  String? confirmLabel,
  bool destructive = false,
}) {
  return TpBottomSheet.show<String>(
    context: context,
    title: title,
    builder: (BuildContext sheet) => _ReasonSheet(
      message: message,
      confirmLabel: confirmLabel,
      destructive: destructive,
    ),
  );
}

class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({
    this.message,
    this.confirmLabel,
    this.destructive = false,
  });

  final String? message;
  final String? confirmLabel;
  final bool destructive;

  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  final TextEditingController _reason = TextEditingController();
  bool _tried = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final String text = _reason.text.trim();
    if (text.length < 3) {
      setState(() => _tried = true);
      return;
    }
    Navigator.of(context).pop(text);
  }

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (widget.message != null) ...<Widget>[
            Text(
              widget.message!,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: TpSpace.md),
          ],
          TpInput(
            key: const Key('fleetSup.reason'),
            label: copy('reasonLabel'),
            hint: copy('reasonHint'),
            controller: _reason,
            isRequired: true,
            maxLength: 300,
            autofocus: true,
            errorText: _tried ? copy('reasonInvalid') : null,
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: TpSpace.md),
          if (widget.destructive)
            TpButton.danger(
              key: const Key('fleetSup.reason.save'),
              label: widget.confirmLabel ?? copy('save'),
              onPressed: _submit,
              isFullWidth: true,
            )
          else
            TpButton.primary(
              key: const Key('fleetSup.reason.save'),
              label: widget.confirmLabel ?? copy('save'),
              onPressed: _submit,
              isFullWidth: true,
            ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            label: copy('cancel'),
            onPressed: () => Navigator.of(context).pop(),
            isFullWidth: true,
          ),
        ],
      ),
    );
  }
}

/// What the driver type and region sheet returns.
final class FleetProfileChoice {
  const FleetProfileChoice({
    required this.category,
    required this.region,
    required this.reason,
  });

  /// Null clears the value.
  final String? category;
  final String? region;
  final String reason;
}

/// Driver type and region: filters only, never ownership.
class FleetProfileSheet extends StatefulWidget {
  const FleetProfileSheet({
    required this.categories,
    this.category,
    this.region,
    super.key,
  });

  final String? category;
  final String? region;

  /// Suggested types; the field also takes free text.
  final List<String> categories;

  @override
  State<FleetProfileSheet> createState() => _FleetProfileSheetState();
}

class _FleetProfileSheetState extends State<FleetProfileSheet> {
  late final TextEditingController _category =
      TextEditingController(text: widget.category ?? '');
  late final TextEditingController _region =
      TextEditingController(text: widget.region ?? '');
  final TextEditingController _reason = TextEditingController();
  bool _tried = false;

  @override
  void dispose() {
    _category.dispose();
    _region.dispose();
    _reason.dispose();
    super.dispose();
  }

  bool get _valid =>
      _category.text.trim().length <= 60 &&
      _region.text.trim().length <= 60 &&
      _reason.text.trim().length >= 3;

  void _submit() {
    if (!_valid) {
      setState(() => _tried = true);
      return;
    }
    String? v(TextEditingController c) =>
        c.text.trim().isEmpty ? null : c.text.trim();
    Navigator.of(context).pop(
      FleetProfileChoice(
        category: v(_category),
        region: v(_region),
        reason: _reason.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            copy('profileHint'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            key: const Key('fleetSup.profile.category'),
            label: copy('categoryLabel'),
            controller: _category,
            maxLength: 60,
            errorText: _tried && _category.text.trim().length > 60
                ? copy('profileTooLong')
                : null,
          ),
          const SizedBox(height: TpSpace.xs),
          Wrap(
            spacing: TpSpace.xs,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              for (final String c in widget.categories)
                ActionChip(
                  label: Text(c),
                  onPressed: () => setState(() => _category.text = c),
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            key: const Key('fleetSup.profile.region'),
            label: copy('regionLabel'),
            controller: _region,
            maxLength: 60,
            errorText: _tried && _region.text.trim().length > 60
                ? copy('profileTooLong')
                : null,
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            key: const Key('fleetSup.profile.reason'),
            label: copy('reasonLabel'),
            controller: _reason,
            isRequired: true,
            maxLength: 300,
            errorText: _tried && _reason.text.trim().length < 3
                ? copy('reasonInvalid')
                : null,
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: TpSpace.md),
          TpButton.primary(
            key: const Key('fleetSup.profile.save'),
            label: copy('save'),
            onPressed: _submit,
            isFullWidth: true,
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            label: copy('cancel'),
            onPressed: () => Navigator.of(context).pop(),
            isFullWidth: true,
          ),
        ],
      ),
    );
  }
}
