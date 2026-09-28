/// Fleet AI assistant (`/ai`, [FleetAiRoute]).
///
/// Ported from `mobile/app/(app)/ai/index.tsx`. The route guard
/// (`ModuleGuarded(RouteModule.ai)`) already decides who may open it.
///
/// NO FABRICATED ANSWERS. The screen first reads exact live counts
/// ([FleetAiSnapshot]); the question is only sent once at least one count was
/// read, and the system prompt forbids any figure that is not in that
/// snapshot. When nothing could be read, sending is blocked and the reason is
/// shown, rather than letting the model answer from nothing.
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
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/extras/data/fleet_ai_repository.dart';
import 'package:tyre_pulse/features/extras/domain/fleet_ai.dart';
import 'package:tyre_pulse/features/extras/extras_providers.dart';

/// Stable keys for tests.
abstract final class FleetAiKeys {
  static const Key input = Key('fleetAi.input');
  static const Key send = Key('fleetAi.send');
  static const Key clear = Key('fleetAi.clear');
  static const Key noData = Key('fleetAi.noData');
  static const Key thinking = Key('fleetAi.thinking');
  static const Key error = Key('fleetAi.error');
  static Key suggestion(int i) => Key('fleetAi.suggestion.$i');
}

class FleetAiScreen extends ConsumerStatefulWidget {
  const FleetAiScreen({required this.route, super.key});

  final FleetAiRoute route;

  @override
  ConsumerState<FleetAiScreen> createState() => _FleetAiScreenState();
}

class _FleetAiScreenState extends ConsumerState<FleetAiScreen> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final List<FleetAiMessage> _messages = <FleetAiMessage>[];

  FleetAiSnapshot? _snapshot;
  bool _loadingSnapshot = true;
  bool _thinking = false;
  FleetAiFailureKind? _failure;

  @override
  void initState() {
    super.initState();
    unawaited(_loadSnapshot());
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  FleetAiRepository get _repository => ref.read(fleetAiRepositoryProvider);

  Future<void> _loadSnapshot() async {
    setState(() => _loadingSnapshot = true);
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final FleetAiSnapshot snapshot =
        await _repository.loadSnapshot(country: workspace?.activeCountry);
    if (!mounted) return;
    setState(() {
      _snapshot = snapshot;
      _loadingSnapshot = false;
    });
  }

  bool get _canSend =>
      !_thinking &&
      !_loadingSnapshot &&
      _snapshot != null &&
      !_snapshot!.isEmpty;

  Future<void> _send([String? preset]) async {
    final String question = (preset ?? _input.text).trim();
    if (question.isEmpty || !_canSend) return;
    final String bounded = question.length > kFleetAiMaxQuestionLength
        ? question.substring(0, kFleetAiMaxQuestionLength)
        : question;
    _input.clear();
    setState(() {
      _messages.add(
        FleetAiMessage(role: FleetAiRole.user, content: bounded),
      );
      _thinking = true;
      _failure = null;
    });
    _scrollToEnd();
    try {
      final String answer = await _repository.ask(
        system: buildFleetAiSystemPrompt(_snapshot!),
        messages: fleetAiWireHistory(_messages),
      );
      if (!mounted) return;
      setState(() {
        _messages.add(
          FleetAiMessage(role: FleetAiRole.assistant, content: answer),
        );
      });
    } on FleetAiFailure catch (failure) {
      if (!mounted) return;
      setState(() => _failure = failure.kind);
    } finally {
      if (mounted) setState(() => _thinking = false);
      _scrollToEnd();
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      unawaited(
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        ),
      );
    });
  }

  void _clear() {
    setState(() {
      _messages.clear();
      _failure = null;
    });
  }

  String _failureText(AppLocalizations l10n, FleetAiFailureKind kind) {
    switch (kind) {
      case FleetAiFailureKind.disabled:
        return l10n.extrasFleetAiErrDisabled;
      case FleetAiFailureKind.budget:
        return l10n.extrasFleetAiErrBudget;
      case FleetAiFailureKind.rateLimited:
        return l10n.extrasFleetAiErrRateLimited;
      case FleetAiFailureKind.offline:
        return l10n.extrasFleetAiErrOffline;
      case FleetAiFailureKind.unavailable:
        return l10n.extrasFleetAiErrUnavailable;
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final FleetAiSnapshot? snapshot = _snapshot;
    final List<String> suggestions = <String>[
      l10n.extrasFleetAiSuggestOverview,
      l10n.extrasFleetAiSuggestRisk,
      l10n.extrasFleetAiSuggestActions,
      l10n.extrasFleetAiSuggestAccidents,
    ];

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.extrasFleetAiTitle,
        subtitle: l10n.extrasFleetAiSubtitle,
        backFallback: fallback,
        actions: <Widget>[
          if (_messages.isNotEmpty)
            IconButton(
              key: FleetAiKeys.clear,
              tooltip: l10n.extrasFleetAiClear,
              icon: const Icon(Icons.delete_sweep_outlined),
              onPressed: _thinking ? null : _clear,
            ),
        ],
      ),
      body: Column(
        children: <Widget>[
          _GroundingBar(
            loading: _loadingSnapshot,
            snapshot: snapshot,
            onRetry: _loadingSnapshot ? null : () => unawaited(_loadSnapshot()),
          ),
          Expanded(
            child: _messages.isEmpty && !_thinking
                ? _EmptyConversation(
                    suggestions: suggestions,
                    enabled: _canSend,
                    onPick: (String q) => unawaited(_send(q)),
                  )
                : ListView(
                    controller: _scroll,
                    padding: const EdgeInsets.all(TpSpace.lg),
                    children: <Widget>[
                      for (final FleetAiMessage message in _messages)
                        _Bubble(message: message),
                      if (_thinking)
                        Padding(
                          key: FleetAiKeys.thinking,
                          padding: const EdgeInsets.all(TpSpace.md),
                          child: Row(
                            children: <Widget>[
                              const SizedBox.square(
                                dimension: TpSizing.iconMd,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              ),
                              const SizedBox(width: TpSpace.sm),
                              Text(l10n.extrasFleetAiThinking),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
          if (_failure != null)
            Padding(
              key: FleetAiKeys.error,
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
              child: TpCard(
                background:
                    TpPalette.of(context).forStatus(TpStatus.critical).soft,
                child: Text(_failureText(l10n, _failure!)),
              ),
            ),
          _Composer(
            controller: _input,
            enabled: _canSend,
            busy: _thinking,
            hint: l10n.extrasFleetAiInputHint,
            sendLabel: l10n.extrasFleetAiSend,
            disclaimer: l10n.extrasFleetAiDisclaimer,
            onSend: () => unawaited(_send()),
          ),
        ],
      ),
    );
  }
}

class _GroundingBar extends StatelessWidget {
  const _GroundingBar({
    required this.loading,
    required this.snapshot,
    required this.onRetry,
  });

  final bool loading;
  final FleetAiSnapshot? snapshot;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final FleetAiSnapshot? s = snapshot;
    final Widget child;
    if (loading) {
      child = Row(
        children: <Widget>[
          const SizedBox.square(
            dimension: TpSizing.iconSm,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(child: Text(l10n.extrasFleetAiSnapshotLoading)),
        ],
      );
    } else if (s == null || s.isEmpty) {
      child = Row(
        key: FleetAiKeys.noData,
        children: <Widget>[
          Icon(
            Icons.cloud_off_outlined,
            color: palette.forStatus(TpStatus.warning).base,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(child: Text(l10n.extrasFleetAiNoData)),
          TextButton(onPressed: onRetry, child: Text(l10n.actionRetry)),
        ],
      );
    } else {
      child = Row(
        children: <Widget>[
          Icon(Icons.dataset_linked_outlined, color: palette.primary),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(l10n.extrasFleetAiGroundedOn(s.readCount)),
          ),
          IconButton(
            tooltip: l10n.actionRetry,
            icon: const Icon(Icons.refresh),
            onPressed: onRetry,
          ),
        ],
      );
    }
    return Material(
      color: palette.surfaceAlt,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.lg,
          vertical: TpSpace.sm,
        ),
        child: DefaultTextStyle.merge(
          style: TextStyle(color: palette.textSecondary),
          child: child,
        ),
      ),
    );
  }
}

class _EmptyConversation extends StatelessWidget {
  const _EmptyConversation({
    required this.suggestions,
    required this.enabled,
    required this.onPick,
  });

  final List<String> suggestions;
  final bool enabled;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    return ListView(
      padding: const EdgeInsets.all(TpSpace.lg),
      children: <Widget>[
        Icon(Icons.auto_awesome_outlined, size: 40, color: palette.primary),
        const SizedBox(height: TpSpace.md),
        Text(
          l10n.extrasFleetAiEmptyTitle,
          textAlign: TextAlign.center,
          style: text.titleMedium,
        ),
        const SizedBox(height: TpSpace.sm),
        Text(
          l10n.extrasFleetAiEmptyMessage,
          textAlign: TextAlign.center,
          style: text.bodyMedium?.copyWith(color: palette.textSecondary),
        ),
        const SizedBox(height: TpSpace.xl),
        Text(l10n.extrasFleetAiSuggestedTitle, style: text.labelLarge),
        const SizedBox(height: TpSpace.sm),
        for (int i = 0; i < suggestions.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: TpCard(
              key: FleetAiKeys.suggestion(i),
              padding: EdgeInsets.zero,
              child: TpActionRow(
                icon: Icons.chat_bubble_outline,
                label: suggestions[i],
                showDivider: false,
                onTap: enabled ? () => onPick(suggestions[i]) : null,
              ),
            ),
          ),
      ],
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final FleetAiMessage message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool mine = message.role == FleetAiRole.user;
    return Align(
      alignment: mine
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Semantics(
          label: mine ? l10n.extrasFleetAiYou : l10n.extrasFleetAiTitle,
          child: Container(
            margin: const EdgeInsets.only(bottom: TpSpace.sm),
            padding: const EdgeInsets.all(TpSpace.md),
            decoration: BoxDecoration(
              color: mine ? palette.primary : palette.surface,
              borderRadius: BorderRadius.circular(TpRadius.lg),
              border: mine ? null : Border.all(color: palette.border),
            ),
            child: SelectableText(
              message.content,
              style: TextStyle(color: mine ? palette.onPrimary : palette.text),
            ),
          ),
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.enabled,
    required this.busy,
    required this.hint,
    required this.sendLabel,
    required this.disclaimer,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool enabled;
  final bool busy;
  final String hint;
  final String sendLabel;
  final String disclaimer;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.sm,
          TpSpace.lg,
          TpSpace.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    key: FleetAiKeys.input,
                    controller: controller,
                    enabled: enabled,
                    minLines: 1,
                    maxLines: 4,
                    maxLength: kFleetAiMaxQuestionLength,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => onSend(),
                    decoration: InputDecoration(
                      hintText: hint,
                      counterText: '',
                    ),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                IconButton.filled(
                  key: FleetAiKeys.send,
                  tooltip: sendLabel,
                  onPressed: enabled && !busy ? onSend : null,
                  icon: const Icon(Icons.send_rounded),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.xs),
            Text(
              disclaimer,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
