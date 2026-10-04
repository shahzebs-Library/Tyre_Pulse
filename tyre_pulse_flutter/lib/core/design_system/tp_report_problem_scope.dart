/// Lets the shared error states offer "Report a problem" without the design
/// system importing a feature.
///
/// The app installs one [TpReportProblemScope] above every route (from
/// `MaterialApp.router`'s `builder` in `main.dart`). [TpErrorState] and
/// [TpBackendUnavailableState] look it up: when it is present they add a
/// quiet secondary "Report a problem" action under Retry; when it is absent
/// (a widget test, a golden) they render exactly as before.
library;

import 'package:flutter/widgets.dart';

/// Opens the report screen. [context] is the error state's own context, so it
/// sits below the app's Navigator and can push.
typedef TpReportProblemHandler = void Function(BuildContext context);

class TpReportProblemScope extends InheritedWidget {
  const TpReportProblemScope({
    required this.onReport,
    required super.child,
    super.key,
  });

  final TpReportProblemHandler onReport;

  static TpReportProblemHandler? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<TpReportProblemScope>()
      ?.onReport;

  @override
  bool updateShouldNotify(TpReportProblemScope oldWidget) =>
      !identical(onReport, oldWidget.onReport);
}
