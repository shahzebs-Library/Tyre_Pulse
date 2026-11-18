/// The real Turnstile platform view: a `webview_flutter` WebView loading the
/// inline page from [turnstileHtml] under [kTurnstileBaseUrl], with events
/// coming back over the [kTurnstileChannel] JavaScript channel.
///
/// Only the top-level page is pinned: any attempt to navigate the main frame
/// away from the inline page (a link inside the widget, a redirect) is
/// refused, so the field cannot become a browser. Turnstile's own iframes
/// (sub-frames on challenges.cloudflare.com) load normally.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/auth/captcha/turnstile_captcha.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Builds WebView-backed Turnstile views.
final class WebViewTurnstileFactory implements TurnstileViewFactory {
  const WebViewTurnstileFactory();

  @override
  TurnstileViewHandle create({
    required String siteKey,
    required bool dark,
    required TurnstileEventSink onEvent,
  }) =>
      _WebViewTurnstileHandle(siteKey: siteKey, dark: dark, onEvent: onEvent);
}

final class _WebViewTurnstileHandle implements TurnstileViewHandle {
  _WebViewTurnstileHandle({
    required String siteKey,
    required bool dark,
    required TurnstileEventSink onEvent,
  }) : _onEvent = onEvent {
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel(
        kTurnstileChannel,
        onMessageReceived: (JavaScriptMessage message) =>
            _emit(parseTurnstileMessage(message.message)),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (NavigationRequest request) {
            if (!request.isMainFrame) return NavigationDecision.navigate;
            final String url = request.url;
            return url.startsWith(kTurnstileBaseUrl) ||
                    url.startsWith('about:') ||
                    url.startsWith('data:')
                ? NavigationDecision.navigate
                : NavigationDecision.prevent;
          },
          onWebResourceError: (WebResourceError error) {
            // Only the page itself failing matters; a sub-resource error
            // inside the challenge is Turnstile's own to report.
            if (error.isForMainFrame ?? false) {
              _emit(TurnstileFailed('page:${error.errorCode}'));
            }
          },
        ),
      );
    _controller.loadHtmlString(
      turnstileHtml(siteKey: siteKey, dark: dark),
      baseUrl: kTurnstileBaseUrl,
    );
  }

  late final WebViewController _controller;
  final TurnstileEventSink _onEvent;
  bool _disposed = false;

  void _emit(TurnstileEvent event) {
    if (_disposed) return;
    _onEvent(event);
  }

  @override
  Widget get view => WebViewWidget(controller: _controller);

  @override
  Future<void> reset() async {
    if (_disposed) return;
    try {
      await _controller.runJavaScript('window.tpReset && window.tpReset();');
    } on Object {
      // A page that cannot run the reset is reported by the caller's own
      // recreate path; nothing to add here.
    }
  }

  @override
  void dispose() {
    _disposed = true;
  }
}

/// The factory the CAPTCHA widget uses. Overridden in widget tests.
final Provider<TurnstileViewFactory> turnstileViewFactoryProvider =
    Provider<TurnstileViewFactory>((ref) => const WebViewTurnstileFactory());
