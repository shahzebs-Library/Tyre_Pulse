/// Self-registration (`/register`, [RegisterRoute], a public route).
///
/// Behaviour mirrors the live web sign-up (`src/pages/Login.jsx`
/// `handleSignup`); see `self_registration_repository.dart` for the contract.
/// Parity note: the Expo `(auth)/register.tsx` shows an invite-only notice.
/// This screen shows that same notice whenever the administrator has closed
/// registration (`registration_open` / `allow_signups` = `'false'`), and the
/// form only while the server says registration is open.
///
/// What the person may NOT choose: a role, a site, an organisation or a
/// country. The server trigger creates a pending `Reporter`; an administrator
/// assigns everything else on approval. A phone number is not collected
/// because `handle_new_user` stores none, and a field that goes nowhere would
/// be a control that does nothing.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/extras/data/self_registration_repository.dart';
import 'package:tyre_pulse/features/extras/extras_providers.dart';

/// Stable keys for tests.
abstract final class RegisterKeys {
  static const Key fullName = Key('register.fullName');
  static const Key username = Key('register.username');
  static const Key employeeId = Key('register.employeeId');
  static const Key password = Key('register.password');
  static const Key confirm = Key('register.confirm');
  static const Key submit = Key('register.submit');
  static const Key closed = Key('register.closed');
  static const Key done = Key('register.done');
  static const Key error = Key('register.error');
}

/// Field-level problems, in form order.
enum RegisterProblem {
  usernameShort,
  usernameChars,
  employeeIdMissing,
  passwordShort,
  passwordMismatch,
}

/// Validates the form exactly as the web does.
List<RegisterProblem> validateRegistration({
  required String username,
  required String employeeId,
  required String password,
  required String confirm,
  required int minPassword,
}) {
  final String name = username.trim();
  return <RegisterProblem>[
    if (name.length < 3) RegisterProblem.usernameShort,
    if (name.length >= 3 && !kUsernamePattern.hasMatch(name))
      RegisterProblem.usernameChars,
    if (employeeId.trim().isEmpty) RegisterProblem.employeeIdMissing,
    if (password.length < minPassword) RegisterProblem.passwordShort,
    if (password != confirm) RegisterProblem.passwordMismatch,
  ];
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({required this.route, super.key});

  final RegisterRoute route;

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

enum _Phase { loading, unreachable, closed, open, done }

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final TextEditingController _fullName = TextEditingController();
  final TextEditingController _username = TextEditingController();
  final TextEditingController _employeeId = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();

  _Phase _phase = _Phase.loading;
  int _minPassword = kDefaultMinPassword;
  bool _submitting = false;
  bool _showProblems = false;
  bool _obscure = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadPolicy());
  }

  @override
  void dispose() {
    _fullName.dispose();
    _username.dispose();
    _employeeId.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _loadPolicy() async {
    setState(() => _phase = _Phase.loading);
    final RegistrationPolicy? policy =
        await ref.read(selfRegistrationRepositoryProvider).loadPolicy();
    if (!mounted) return;
    setState(() {
      if (policy == null) {
        _phase = _Phase.unreachable;
      } else {
        _minPassword = policy.minPassword;
        _phase = policy.open ? _Phase.open : _Phase.closed;
      }
    });
  }

  void _toLogin() => context.go(const LoginRoute().location);

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<RegisterProblem> problems = _problems();
    if (problems.isNotEmpty) {
      setState(() => _showProblems = true);
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final SelfRegistrationResult result =
        await ref.read(selfRegistrationRepositoryProvider).register(
              username: _username.text,
              employeeId: _employeeId.text,
              password: _password.text,
              fullName: _fullName.text,
            );
    if (!mounted) return;
    setState(() {
      _submitting = false;
      switch (result) {
        case SelfRegistrationResult.created:
          _phase = _Phase.done;
        case SelfRegistrationResult.closed:
          _phase = _Phase.closed;
        case SelfRegistrationResult.taken:
          _error = l10n.registerErrTaken;
        case SelfRegistrationResult.offline:
          _error = l10n.registerErrOffline;
        case SelfRegistrationResult.failed:
          _error = l10n.registerErrFailed;
      }
    });
  }

  List<RegisterProblem> _problems() => validateRegistration(
        username: _username.text,
        employeeId: _employeeId.text,
        password: _password.text,
        confirm: _confirm.text,
        minPassword: _minPassword,
      );

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Widget body = switch (_phase) {
      _Phase.loading => TpLoadingState(message: l10n.registerChecking),
      _Phase.unreachable => TpStateView(
          icon: Icons.cloud_off_outlined,
          tone: TpStatus.warning,
          title: l10n.registerUnreachableTitle,
          message: l10n.registerUnreachableMessage,
          primaryActionLabel: l10n.actionRetry,
          onPrimaryAction: () => unawaited(_loadPolicy()),
          secondaryActionLabel: l10n.registerBackToSignIn,
          onSecondaryAction: _toLogin,
        ),
      _Phase.closed => TpStateView(
          key: RegisterKeys.closed,
          icon: Icons.verified_user_outlined,
          tone: TpStatus.info,
          title: l10n.registerClosedTitle,
          message: l10n.registerClosedMessage,
          primaryActionLabel: l10n.registerBackToSignIn,
          onPrimaryAction: _toLogin,
        ),
      _Phase.done => TpStateView(
          key: RegisterKeys.done,
          icon: Icons.hourglass_top_outlined,
          tone: TpStatus.ok,
          title: l10n.registerDoneTitle,
          message: l10n.registerDoneMessage,
          primaryActionLabel: l10n.registerBackToSignIn,
          onPrimaryAction: _toLogin,
        ),
      _Phase.open => _buildForm(context, l10n),
    };
    return TpScaffold(
      backFallback: TpRoutePaths.login,
      appBar: TpAppBar(
        title: l10n.registerTitle,
        backFallback: TpRoutePaths.login,
      ),
      body: body,
    );
  }

  Widget _buildForm(BuildContext context, AppLocalizations l10n) {
    final List<RegisterProblem> problems =
        _showProblems ? _problems() : const <RegisterProblem>[];
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    String? usernameError() {
      if (problems.contains(RegisterProblem.usernameShort)) {
        return l10n.registerErrUsernameShort;
      }
      if (problems.contains(RegisterProblem.usernameChars)) {
        return l10n.registerErrUsernameChars;
      }
      return null;
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(TpSpace.lg),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const TpBrandLockup(),
                const SizedBox(height: TpSpace.lg),
                Text(
                  l10n.registerIntro,
                  style:
                      text.bodyMedium?.copyWith(color: palette.textSecondary),
                ),
                const SizedBox(height: TpSpace.xl),
                TpInput(
                  key: RegisterKeys.fullName,
                  label: l10n.registerFullName,
                  hint: l10n.registerOptional,
                  controller: _fullName,
                  enabled: !_submitting,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: TpSpace.lg),
                TpInput(
                  key: RegisterKeys.username,
                  label: l10n.registerUsername,
                  helperText: l10n.registerUsernameHelp,
                  controller: _username,
                  isRequired: true,
                  enabled: !_submitting,
                  textInputAction: TextInputAction.next,
                  errorText: usernameError(),
                ),
                const SizedBox(height: TpSpace.lg),
                TpInput(
                  key: RegisterKeys.employeeId,
                  label: l10n.registerEmployeeId,
                  controller: _employeeId,
                  isRequired: true,
                  enabled: !_submitting,
                  textInputAction: TextInputAction.next,
                  errorText:
                      problems.contains(RegisterProblem.employeeIdMissing)
                          ? l10n.registerErrEmployeeId
                          : null,
                ),
                const SizedBox(height: TpSpace.lg),
                TpInput(
                  key: RegisterKeys.password,
                  label: l10n.registerPassword,
                  helperText: l10n.registerPasswordHelp(_minPassword),
                  controller: _password,
                  isRequired: true,
                  obscureText: _obscure,
                  enabled: !_submitting,
                  textInputAction: TextInputAction.next,
                  suffix: IconButton(
                    tooltip: _obscure
                        ? l10n.registerShowPassword
                        : l10n.registerHidePassword,
                    icon: Icon(
                      _obscure
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                  errorText: problems.contains(RegisterProblem.passwordShort)
                      ? l10n.registerErrPasswordShort(_minPassword)
                      : null,
                ),
                const SizedBox(height: TpSpace.lg),
                TpInput(
                  key: RegisterKeys.confirm,
                  label: l10n.registerConfirm,
                  controller: _confirm,
                  isRequired: true,
                  obscureText: _obscure,
                  enabled: !_submitting,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => unawaited(_submit()),
                  errorText: problems.contains(RegisterProblem.passwordMismatch)
                      ? l10n.registerErrMismatch
                      : null,
                ),
                const SizedBox(height: TpSpace.lg),
                Text(
                  l10n.registerApprovalNote,
                  style: text.bodySmall?.copyWith(color: palette.textMuted),
                ),
                if (_error != null) ...<Widget>[
                  const SizedBox(height: TpSpace.md),
                  TpCard(
                    key: RegisterKeys.error,
                    background: palette.forStatus(TpStatus.critical).soft,
                    child: Text(_error!),
                  ),
                ],
                const SizedBox(height: TpSpace.xl),
                TpButton.primary(
                  key: RegisterKeys.submit,
                  label: l10n.registerSubmit,
                  isBusy: _submitting,
                  isFullWidth: true,
                  onPressed: _submitting ? null : () => unawaited(_submit()),
                ),
                const SizedBox(height: TpSpace.md),
                TextButton(
                  onPressed: _submitting ? null : _toLogin,
                  child: Text(l10n.registerHaveAccount),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
