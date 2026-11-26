/// The handover as an authorization paper: both drivers' signatures with
/// their names and server times, the location recorded with them, and the
/// freeze that follows the first signature.
///
/// Signing goes through `sign_handover` only, online only: the time, the
/// account that collected the signature and the location are stamped by the
/// server, and the record locks itself after the first signature. Offline,
/// nothing is queued; the screen says so and keeps the drawn mark so the
/// driver can try again once connected.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/documents/handover_document.dart'
    show handoverDocumentNumber, handoverMapUrl, handoverRowLocation;
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/handover/data/handover_location.dart';
import 'package:tyre_pulse/features/handover/data/handover_remote_repository.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';
import 'package:tyre_pulse/features/handover/domain/handover_signing.dart';
import 'package:tyre_pulse/features/handover/handover_providers.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_ui.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_signature_pad.dart';
import 'package:url_launcher/url_launcher.dart';

/// The plain sentence for a failed signature.
String handoverSignErrorText(AppLocalizations l10n, Object error) {
  if (error is SupabaseFailure) {
    switch (error.cause) {
      case SupabaseFailureCause.offline:
      case SupabaseFailureCause.timeout:
        return l10n.handoverAuthOffline;
      case SupabaseFailureCause.schemaMismatch:
        return l10n.handoverAuthNotAvailable;
      default:
        return error.error.message;
    }
  }
  return handoverAsAppError(error, l10n.handoverSignFailedMessage).message;
}

class HandoverSigningPanel extends ConsumerStatefulWidget {
  const HandoverSigningPanel({
    required this.record,
    required this.onSigned,
    super.key,
  });

  final HandoverRecord record;
  final Future<void> Function() onSigned;

  @override
  ConsumerState<HandoverSigningPanel> createState() =>
      _HandoverSigningPanelState();
}

class _HandoverSigningPanelState extends ConsumerState<HandoverSigningPanel> {
  final TextEditingController _name = TextEditingController();
  String? _signature;
  bool _busy = false;
  bool _readingLocation = false;
  String? _message;
  HandoverParty? _preparedFor;

  /// The driver linked to this account, read once. Null while unknown or when
  /// the account is not a driver: the screen then asks for on-behalf.
  String? _myDriverId;
  bool _myDriverLoaded = false;
  bool _behalfConfirmed = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadMyDriver());
  }

  Future<void> _loadMyDriver() async {
    final String userId = ref.read(workspaceContextProvider)?.userId ?? '';
    final String? id = await ref
        .read(handoverRemoteRepositoryProvider)
        .myLinkedDriverId(userId);
    if (mounted) {
      setState(() {
        _myDriverId = id;
        _myDriverLoaded = true;
      });
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _prepare(HandoverParty party) {
    if (_preparedFor == party) return;
    _preparedFor = party;
    _signature = null;
    _message = null;
    _behalfConfirmed = false;
    _name.text = (party == HandoverParty.handing
            ? widget.record.fromDriver
            : widget.record.toDriver) ??
        '';
  }

  Future<void> _sign(HandoverParty party) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final HandoverSigningMode mode =
        rowSigningMode(widget.record, party, _myDriverId);
    if (mode == HandoverSigningMode.blocked) {
      setState(() => _message = l10n.handoverAuthBlocked);
      return;
    }
    if (mustLeaveReceivingToAnother(
      record: widget.record,
      myUserId: ref.read(workspaceContextProvider)?.userId,
    )) {
      setState(() => _message = l10n.handoverAuthReceivingOtherAccount);
      return;
    }
    final String? signature = _signature;
    if (signature == null || signature.isEmpty) {
      setState(() => _message = l10n.driverChargeIssueSignature);
      return;
    }
    if (!isValidHandoverSignature(signature)) {
      setState(() => _message = l10n.signatureSignAgain);
      return;
    }
    if (mode == HandoverSigningMode.onBehalf && !_behalfConfirmed) {
      setState(() => _message = l10n.handoverAuthOnBehalfRequired);
      return;
    }
    final bool needsName = !widget.record.partyHasRegisterDriver(party);
    if (needsName && _name.text.trim().length < 2) {
      setState(() => _message = l10n.handoverAuthSignerName);
      return;
    }
    setState(() {
      _busy = true;
      _readingLocation = true;
      _message = null;
    });
    try {
      final HandoverLocationReading location =
          await ref.read(handoverLocationReaderProvider).read();
      if (!mounted) return;
      setState(() => _readingLocation = false);
      await ref.read(handoverRemoteRepositoryProvider).sign(
            HandoverSignInput(
              handoverId: widget.record.id,
              party: party,
              signature: signature,
              signerName: needsName ? _name.text.trim() : null,
              latitude: location.captured ? location.latitude : null,
              longitude: location.captured ? location.longitude : null,
              accuracyMeters:
                  location.captured ? location.accuracyMeters : null,
              locationStatus: location.captured ? null : location.status,
              onBehalf: mode == HandoverSigningMode.onBehalf,
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.handoverAuthSigned)));
      _preparedFor = null;
      _signature = null;
      await widget.onSigned();
    } on Object catch (error) {
      if (mounted) {
        setState(() => _message = handoverSignErrorText(l10n, error));
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _readingLocation = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final HandoverRecord r = widget.record;
    final HandoverParty? next = r.nextParty;
    if (next != null) _prepare(next);
    final loc = handoverRowLocation(r.row);

    Widget partyCard(
      String title,
      String? name,
      String? signedAt,
      String? signature,
      bool onBehalf,
    ) =>
        TpCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title, style: theme.textTheme.labelLarge),
              const SizedBox(height: TpSpace.xs),
              if (signedAt == null)
                Text(l10n.handoverAuthNotSigned)
              else ...<Widget>[
                Text(
                  l10n.handoverAuthSignedLine(
                    name ?? l10n.valueUnavailable,
                    formatHandoverDateTime(signedAt) ?? l10n.valueUnavailable,
                  ),
                ),
                if (onBehalf)
                  Text(
                    l10n.handoverAuthSignedOnBehalf,
                    style: theme.textTheme.bodySmall,
                  ),
                const SizedBox(height: TpSpace.xs),
                HandoverSignaturePreview(
                  value: signature,
                  fallback: Text(
                    l10n.handoverSignatureMissing,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ],
          ),
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          l10n.handoverAuthSignaturesTitle,
          style: theme.textTheme.titleMedium,
        ),
        Text(
          l10n.handoverAuthDocumentNo(handoverDocumentNumber(r.row)),
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: TpSpace.sm),
        partyCard(
          l10n.handoverAuthHanding,
          r.fromSignedName ?? r.fromDriver,
          r.fromSignedAt,
          r.fromSignature,
          r.fromOnBehalf,
        ),
        const SizedBox(height: TpSpace.sm),
        partyCard(
          l10n.handoverAuthReceiving,
          r.toSignedName ?? r.toDriver,
          r.toSignedAt,
          r.toSignature,
          r.toOnBehalf,
        ),
        if (r.isFrozen) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              const Icon(Icons.lock_outline, size: 18),
              const SizedBox(width: TpSpace.xs),
              Expanded(child: Text(l10n.handoverAuthFrozen)),
            ],
          ),
        ],
        const SizedBox(height: TpSpace.md),
        Text(l10n.handoverAuthLocation, style: theme.textTheme.titleSmall),
        if (loc != null) ...<Widget>[
          Text(
            l10n.handoverAuthLocationCaptured(
              '${loc.lat.toStringAsFixed(5)}, ${loc.lng.toStringAsFixed(5)}'
              '${loc.accuracy == null ? '' : ' (±${loc.accuracy!.round()} m)'}',
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              icon: const Icon(Icons.map_outlined),
              label: Text(l10n.handoverAuthOpenMap),
              onPressed: () => unawaited(
                launchUrl(
                  Uri.parse(handoverMapUrl(loc.lat, loc.lng)),
                  mode: LaunchMode.externalApplication,
                ),
              ),
            ),
          ),
        ] else
          Text(
            switch (r.locationStatus) {
              'denied' => l10n.handoverAuthLocationDenied,
              'unavailable' => l10n.handoverAuthLocationUnavailable,
              _ => l10n.handoverAuthLocationNone,
            },
          ),
        if (next != null) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            next == HandoverParty.handing
                ? l10n.handoverAuthSignHanding
                : l10n.handoverAuthSignReceiving,
            style: theme.textTheme.titleMedium,
          ),
          Text(l10n.handoverAuthHandingFirst, style: theme.textTheme.bodySmall),
          const SizedBox(height: TpSpace.sm),
          if (!_myDriverLoaded)
            const LinearProgressIndicator()
          else if (mustLeaveReceivingToAnother(
            record: r,
            myUserId: ref.watch(workspaceContextProvider)?.userId,
          ))
            TpCard(child: Text(l10n.handoverAuthReceivingOtherAccount))
          else if (rowSigningMode(r, next, _myDriverId) ==
              HandoverSigningMode.blocked)
            TpCard(child: Text(l10n.handoverAuthBlocked))
          else ...<Widget>[
            if (!r.partyHasRegisterDriver(next)) ...<Widget>[
              TpInput(
                label: l10n.handoverAuthSignerName,
                controller: _name,
                hint: l10n.handoverAuthSignerHint,
                textCapitalization: TextCapitalization.words,
              ),
              const SizedBox(height: TpSpace.sm),
            ],
            if (rowSigningMode(r, next, _myDriverId) ==
                HandoverSigningMode.onBehalf)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _behalfConfirmed,
                onChanged: _busy
                    ? null
                    : (bool? v) =>
                        setState(() => _behalfConfirmed = v ?? false),
                title: Text(
                  l10n.handoverAuthOnBehalf(
                    (r.partyHasRegisterDriver(next)
                            ? (next == HandoverParty.handing
                                ? r.fromDriver
                                : r.toDriver)
                            : _name.text.trim()) ??
                        l10n.valueUnavailable,
                  ),
                ),
              ),
            TpCard(
              child: HandoverSignaturePad(
                key: ValueKey<String>('sign-${next.key}'),
                value: _signature,
                height: 180,
                onChanged: (String? v) => setState(() => _signature = v),
              ),
            ),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.sm),
                child: Text(
                  _message!,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            const SizedBox(height: TpSpace.sm),
            if (_readingLocation)
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.sm),
                child: Text(l10n.handoverAuthReadingLocation),
              ),
            FilledButton.icon(
              onPressed: _busy ? null : () => unawaited(_sign(next)),
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.draw_outlined),
              label: Text(l10n.handoverAuthSignSubmit),
            ),
          ],
        ],
      ],
    );
  }
}
