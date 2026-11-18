/// Cloudflare Turnstile CAPTCHA for the sign-in and self-registration forms.
///
/// Mirrors the web's `src/components/auth/TurnstileWidget.jsx`:
///
/// - The site key comes from `--dart-define=TURNSTILE_SITE_KEY`
///   (`AppConfig.turnstileSiteKeyFromEnvironment`). Empty means the feature is
///   OFF: no widget, no network call, and every auth call is sent exactly as
///   before. That is the state production runs in until Supabase Auth CAPTCHA
///   protection is switched on.
/// - A Turnstile token is SINGLE USE. Every caller resets the widget after
///   every attempt, successful or not, or the next attempt is refused.
/// - The token goes to `signInWithPassword` / `signUp` as `captchaToken`, and
///   to the `sign-in` edge function body as `captcha_token`.
///
/// This file is pure Dart (no widget, no platform view): the event model, the
/// token reducer, the HTML page the WebView loads and the refusal detector, so
/// each is unit tested without a device. The platform view lives behind
/// [TurnstileViewFactory] so widget tests can fake it.
library;

import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;
import 'package:tyre_pulse/app/config/app_config.dart';

/// The page origin the widget runs under. Turnstile checks the hostname
/// against the widget's allowed domains, so the inline page is loaded with
/// this as its base URL; `tyrepulse.app` is already an allowed domain for the
/// web app's widget.
const String kTurnstileBaseUrl = 'https://tyrepulse.app/';

/// The JavaScript channel the page posts its events on.
const String kTurnstileChannel = 'TpTurnstile';

/// Height reserved for the Turnstile iframe (the "normal" widget is 65 px).
const double kTurnstileViewHeight = 70;

/// How long the challenge may take to appear before the screen offers Retry.
const Duration kTurnstileLoadTimeout = Duration(seconds: 20);

// ---------------------------------------------------------------------------
// Events from the page
// ---------------------------------------------------------------------------

/// Something the Turnstile page reported.
sealed class TurnstileEvent {
  const TurnstileEvent();
}

/// The script loaded and the challenge rendered; waiting for the person.
final class TurnstileReady extends TurnstileEvent {
  const TurnstileReady();
}

/// The challenge was solved. [token] is single use.
final class TurnstileToken extends TurnstileEvent {
  const TurnstileToken(this.token);
  final String token;
}

/// The token expired (or the challenge timed out) before it was used.
final class TurnstileExpired extends TurnstileEvent {
  const TurnstileExpired();
}

/// The script could not load, the page failed, or Turnstile reported an
/// error. [code] is diagnostic only and is never shown to a person.
final class TurnstileFailed extends TurnstileEvent {
  const TurnstileFailed(this.code);
  final String code;
}

/// Decodes one message posted on [kTurnstileChannel]. Anything unrecognised
/// is a failure, never a token: a malformed message must not unlock sign-in.
TurnstileEvent parseTurnstileMessage(String raw) {
  Object? decoded;
  try {
    decoded = jsonDecode(raw);
  } on FormatException {
    return const TurnstileFailed('malformed');
  }
  if (decoded is! Map) return const TurnstileFailed('malformed');
  final Object? kind = decoded['e'];
  final Object? value = decoded['v'];
  switch (kind) {
    case 'ready':
      return const TurnstileReady();
    case 'token':
      if (value is String && value.trim().isNotEmpty) {
        return TurnstileToken(value.trim());
      }
      return const TurnstileFailed('empty_token');
    case 'expired':
      return const TurnstileExpired();
    case 'error':
      return TurnstileFailed(value is String && value.isNotEmpty ? value : '');
  }
  return const TurnstileFailed('unknown');
}

// ---------------------------------------------------------------------------
// Token state
// ---------------------------------------------------------------------------

/// What the widget is showing.
enum TurnstileStatus {
  /// The page or the script is still loading.
  loading,

  /// The challenge is on screen and has not been solved.
  waiting,

  /// Solved; a token is held.
  solved,

  /// The token expired before it was used.
  expired,

  /// The check could not load or reported an error.
  failed,

  /// Nothing arrived within [kTurnstileLoadTimeout].
  timedOut,
}

/// The widget's token and status. Immutable; [apply] is the reducer.
@immutable
final class TurnstileState {
  const TurnstileState._(this.status, this.token);

  /// A freshly created (or recreated) view.
  const TurnstileState.loading() : this._(TurnstileStatus.loading, null);

  final TurnstileStatus status;

  /// Non-null only while [status] is [TurnstileStatus.solved].
  final String? token;

  bool get hasToken => token != null;

  /// Whether the screen should offer Retry.
  bool get canRetry =>
      status == TurnstileStatus.expired ||
      status == TurnstileStatus.failed ||
      status == TurnstileStatus.timedOut;

  /// The next state after [event]. Any event other than a token clears the
  /// token: an expired or failed check must not leave a stale token behind.
  TurnstileState apply(TurnstileEvent event) => switch (event) {
        TurnstileReady() => status == TurnstileStatus.solved
            ? this
            : const TurnstileState._(TurnstileStatus.waiting, null),
        TurnstileToken(:final String token) =>
          TurnstileState._(TurnstileStatus.solved, token),
        TurnstileExpired() =>
          const TurnstileState._(TurnstileStatus.expired, null),
        TurnstileFailed() =>
          const TurnstileState._(TurnstileStatus.failed, null),
      };

  /// The load timer fired. Ignored once the challenge has shown up.
  TurnstileState timedOut() => status == TurnstileStatus.loading
      ? const TurnstileState._(TurnstileStatus.timedOut, null)
      : this;

  /// After an attempt used the token (or the person asked to retry an
  /// expired check): the same challenge is shown again, unsolved.
  TurnstileState afterReset() =>
      const TurnstileState._(TurnstileStatus.waiting, null);

  @override
  bool operator ==(Object other) =>
      other is TurnstileState && other.status == status && other.token == token;

  @override
  int get hashCode => Object.hash(status, token);

  @override
  String toString() =>
      'TurnstileState($status, token: ${hasToken ? '*' : '-'})';
}

// ---------------------------------------------------------------------------
// Refusal detection
// ---------------------------------------------------------------------------

/// True when [error] is Supabase Auth refusing the request for its CAPTCHA
/// (`captcha_failed`, or any message naming the captcha). Read the code first;
/// the message fallback covers older auth servers that send no code.
bool isCaptchaRefusal(Object? error) {
  if (error == null) return false;
  if (error is AuthException) {
    if ((error.code ?? '').toLowerCase().contains('captcha')) return true;
    return error.message.toLowerCase().contains('captcha');
  }
  if (error is String) return error.toLowerCase().contains('captcha');
  return false;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/// The inline HTML page the WebView loads (with [kTurnstileBaseUrl] as its
/// base URL). Values are embedded through `jsonEncode`, so a site key can
/// never break out of its string literal.
String turnstileHtml({required String siteKey, required bool dark}) {
  final String key = jsonEncode(siteKey);
  final String theme = jsonEncode(dark ? 'dark' : 'light');
  const String channel = kTurnstileChannel;
  return '''
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
#w{display:flex;justify-content:center;align-items:center;min-height:${kTurnstileViewHeight.toInt()}px}
</style>
<script>
function tpPost(o){try{$channel.postMessage(JSON.stringify(o));}catch(e){}}
var tpWidget=null;
function tpFit(){var w=window.innerWidth||300;if(w<300){document.body.style.zoom=String(w/300);}}
function tpOnLoad(){
  tpFit();
  try{
    tpWidget=turnstile.render('#w',{
      sitekey:$key,
      theme:$theme,
      language:'auto',
      appearance:'always',
      'refresh-expired':'manual',
      callback:function(t){tpPost({e:'token',v:t});},
      'expired-callback':function(){tpPost({e:'expired'});},
      'timeout-callback':function(){tpPost({e:'expired'});},
      'error-callback':function(c){tpPost({e:'error',v:String(c||'')});return true;}
    });
    tpPost({e:'ready'});
  }catch(err){tpPost({e:'error',v:'render'});}
}
window.tpReset=function(){if(tpWidget!==null&&window.turnstile){try{turnstile.reset(tpWidget);}catch(e){}}};
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=tpOnLoad" async defer onerror="tpPost({e:'error',v:'load'})"></script>
</head>
<body><div id="w"></div></body>
</html>
''';
}

// ---------------------------------------------------------------------------
// Platform view seam
// ---------------------------------------------------------------------------

/// Receives events from a running view.
typedef TurnstileEventSink = void Function(TurnstileEvent event);

/// One running Turnstile page.
abstract interface class TurnstileViewHandle {
  /// The platform view to place in the tree.
  Widget get view;

  /// Re-arms the same challenge (the token was used or expired).
  Future<void> reset();

  /// Releases the page.
  void dispose();
}

/// Creates [TurnstileViewHandle]s. The real one is a WebView
/// (`turnstile_webview.dart`); tests supply a fake so no platform view is
/// needed.
abstract interface class TurnstileViewFactory {
  TurnstileViewHandle create({
    required String siteKey,
    required bool dark,
    required TurnstileEventSink onEvent,
  });
}

/// The build's Turnstile site key. Empty = CAPTCHA off.
final Provider<String> turnstileSiteKeyProvider = Provider<String>(
  (ref) => AppConfig.turnstileSiteKeyFromEnvironment.trim(),
);
