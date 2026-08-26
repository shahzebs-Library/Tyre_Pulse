/// The workspace as the UI sees it: resolved, resolving, or refused.
///
/// Kept in a pure file, with no Flutter and no Riverpod, so the state machine
/// is unit-testable without a widget binding. The notifier in
/// `workspace_providers.dart` holds one of these and nothing else.
///
/// Four states, not two. AGENTS.md: loading, empty, offline-cached,
/// permission-denied, backend-unavailable, not-configured and error are
/// different states with different renderings, and a spinner is none of them.
/// Here that means [isResolving] and [lastError] are separate signals, and a
/// screen must never fuse them into one branch: a refusal never ends by
/// itself, so a spinner shown for one runs forever. That defect was reported as
/// "I feel is spinner but in actual no access".
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// Immutable state of the active workspace.
final class WorkspaceState {
  const WorkspaceState({
    this.workspace,
    this.isResolving = false,
    this.lastError,
    this.warnings = const <AppError>[],
  });

  /// Nothing resolved yet. The shell shows its splash, not an empty app.
  const WorkspaceState.unresolved()
      : workspace = null,
        isResolving = false,
        lastError = null,
        warnings = const <AppError>[];

  /// The active workspace, or null when none has been adopted yet.
  final WorkspaceContext? workspace;

  /// True while a switch is in flight. Distinct from [lastError] on purpose.
  final bool isResolving;

  /// The reason the last change was REFUSED. The workspace in [workspace] is
  /// still the one in force - a refusal never half-applies.
  final AppError? lastError;

  /// Non-fatal problems from the last successful change, such as a currency
  /// that could not be resolved. Surfaced, never swallowed.
  final List<AppError> warnings;

  bool get isReady => workspace != null;

  bool get hasWarnings => warnings.isNotEmpty;

  WorkspaceState copyWith({
    WorkspaceContext? workspace,
    bool? isResolving,
    AppError? lastError,
    bool clearLastError = false,
    List<AppError>? warnings,
  }) =>
      WorkspaceState(
        workspace: workspace ?? this.workspace,
        isResolving: isResolving ?? this.isResolving,
        lastError: clearLastError ? null : (lastError ?? this.lastError),
        warnings: warnings ?? this.warnings,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is WorkspaceState &&
          other.workspace == workspace &&
          other.isResolving == isResolving &&
          other.lastError == lastError &&
          other.warnings.length == warnings.length;

  @override
  int get hashCode =>
      Object.hash(workspace, isResolving, lastError, warnings.length);

  @override
  String toString() {
    final String errorText = lastError?.kind.name ?? 'none';
    return 'WorkspaceState(ready: $isReady, resolving: $isResolving, '
        'error: $errorText, warnings: ${warnings.length})';
  }
}
