import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

@widgetbook.UseCase(name: 'Default', type: TpLoadingState, path: CataloguePath.states)
Widget loadingState(BuildContext context) {
  final bool custom = context.knobs.boolean(label: 'Custom message', initialValue: false);
  return TpLoadingState(message: custom ? labelKnob(context, 'Loading inspections') : null);
}

@widgetbook.UseCase(name: 'Default and with action', type: TpEmptyState, path: CataloguePath.states)
Widget emptyState(BuildContext context) {
  final bool action = context.knobs.boolean(label: 'With action', initialValue: true);
  return TpEmptyState(
    title: labelKnob(context, 'No inspections yet'),
    message: 'Inspections you record on this device appear here.',
    icon: Icons.assignment_outlined,
    actionLabel: action ? 'New inspection' : null,
    onAction: action ? noop : null,
  );
}

@widgetbook.UseCase(name: 'Default', type: TpOfflineCachedState, path: CataloguePath.states)
Widget offlineCachedState(BuildContext context) {
  final bool retry = context.knobs.boolean(label: 'With retry', initialValue: true);
  return TpOfflineCachedState(
    cachedAtLabel: 'Saved today at 07:42',
    onRetry: retry ? noop : null,
  );
}

@widgetbook.UseCase(name: 'With reason', type: TpPermissionDeniedState, path: CataloguePath.states)
Widget permissionDeniedState(BuildContext context) {
  return TpPermissionDeniedState(
    reason: labelKnob(context, 'Only a supervisor can approve inspections.'),
    onBack: noop,
  );
}

@widgetbook.UseCase(name: 'Default', type: TpBackendUnavailableState, path: CataloguePath.states)
Widget backendUnavailableState(BuildContext context) {
  return const TpBackendUnavailableState(onRetry: noop, detail: 'Ref 7F2A');
}

@widgetbook.UseCase(name: 'Default', type: TpNotConfiguredState, path: CataloguePath.states)
Widget notConfiguredState(BuildContext context) {
  return TpNotConfiguredState(detail: labelKnob(context, 'Washing is not set up for this site.'));
}

@widgetbook.UseCase(name: 'By error kind', type: TpErrorState, path: CataloguePath.states)
Widget errorState(BuildContext context) {
  final String kind = context.knobs.object.dropdown<String>(
    label: 'Error',
    options: const <String>['network (retryable)', 'conflict', 'authentication'],
  );
  final bool report = context.knobs.boolean(label: 'Report a problem available', initialValue: true);
  final AppError error = switch (kind) {
    'conflict' => const AppError.conflict(),
    'authentication' => const AppError.authentication(),
    _ => const AppError.network(),
  };
  final Widget state = TpErrorState(error: error, onRetry: noop);
  return report
      ? TpReportProblemScope(onReport: (_) {}, child: state)
      : state;
}

@widgetbook.UseCase(name: 'Default', type: TpScreenNotAvailableState, path: CataloguePath.states)
Widget screenNotAvailableState(BuildContext context) {
  return const TpScreenNotAvailableState(routeId: '/fleet-ai', onBack: noop);
}

@widgetbook.UseCase(name: 'Custom state by tone', type: TpStateView, path: CataloguePath.states)
Widget stateView(BuildContext context) {
  final TpStatus tone = context.knobs.object.dropdown<TpStatus>(
    label: 'Tone',
    options: TpStatus.values,
    labelBuilder: (TpStatus s) => s.name,
  );
  return TpStateView(
    icon: Icons.local_shipping_outlined,
    tone: tone,
    title: 'Vehicle is in the workshop',
    message: labelKnob(context, 'Inspections are paused until it is released.'),
    detail: 'Job card GCKR/JC/0082/0323',
    primaryActionLabel: 'Open job card',
    onPrimaryAction: noop,
    secondaryActionLabel: 'Back',
    onSecondaryAction: noop,
  );
}

/// The seven states side by side, to check that each reads differently.
@widgetbook.UseCase(name: 'All states side by side', type: TpStateView, path: CataloguePath.states)
Widget allStates(BuildContext context) {
  return CatalogueFrame(
    children: const <Widget>[
      Labelled('Loading', StateBox(height: 180, child: TpLoadingState())),
      Labelled('Empty', StateBox(child: TpEmptyState())),
      Labelled('Offline (cached)', StateBox(child: TpOfflineCachedState(onRetry: noop))),
      Labelled(
        'Permission denied',
        StateBox(child: TpPermissionDeniedState(reason: 'Your role cannot open this.')),
      ),
      Labelled('Backend unavailable', StateBox(child: TpBackendUnavailableState(onRetry: noop))),
      Labelled('Not configured', StateBox(child: TpNotConfiguredState())),
      Labelled('Error', StateBox(child: TpErrorState(error: AppError.network(), onRetry: noop))),
      Labelled('Screen not available', StateBox(child: TpScreenNotAvailableState())),
    ],
  );
}
