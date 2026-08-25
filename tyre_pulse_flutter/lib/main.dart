import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/config/app_config.dart';

/// Application entry point.
///
/// Configuration is resolved BEFORE any client is constructed. If it is
/// missing, the app renders a screen that says so. It does not throw, and it
/// does not render nothing: the web application shipped a build with the
/// Supabase environment absent and showed a silent white page, because the
/// client threw at module load before an error boundary existed. That is a
/// recorded incident in this project, and this is the mobile app's answer to
/// it.
void main() {
  WidgetsFlutterBinding.ensureInitialized();

  final configResult = AppConfig.resolve();

  runApp(
    ProviderScope(
      child: switch (configResult) {
        AppConfigValid() => const TyrePulseApp(),
        AppConfigInvalid(problems: final problems) =>
          ConfigurationProblemApp(problems: problems),
      },
    ),
  );
}

/// The application shell.
///
/// PHASE 1 SCAFFOLD. The router, theme, localisation and session gate land in
/// phase 2 (spec section 67). This deliberately does not fake a home screen:
/// AGENTS.md rule 7 forbids a control that does nothing, so there are no
/// buttons here to press.
class TyrePulseApp extends StatelessWidget {
  const TyrePulseApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tyre Pulse',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF16A34A)),
      ),
      home: const Scaffold(
        body: Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'Tyre Pulse foundation is in place.\n\n'
              'Navigation, sign in and the offline store land in the next '
              'phase.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown when the build was compiled without usable configuration.
///
/// This is a real state with a real explanation, not a spinner. Spec section
/// 58 lists the states that must be distinguishable; "not configured" is one
/// of them. The reader of this screen usually cannot fix it themselves, so it
/// says whose problem it is.
class ConfigurationProblemApp extends StatelessWidget {
  const ConfigurationProblemApp({required this.problems, super.key});

  final List<String> problems;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tyre Pulse',
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'This app is not set up correctly',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
                const Text(
                  'This is a problem with how the app was built, not with your '
                  'account or your connection. Sending this screen to your '
                  'administrator is the fastest way to get it fixed.',
                ),
                const SizedBox(height: 20),
                for (final problem in problems)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('- '),
                        Expanded(child: Text(problem)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
