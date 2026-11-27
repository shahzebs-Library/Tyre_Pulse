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
