import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'features/auth/domain/entities/app_user.dart';
import 'features/auth/presentation/providers/auth_provider.dart';
import 'features/auth/presentation/screens/change_password_screen.dart';
import 'features/auth/presentation/screens/login_screen.dart';
import 'features/employee/presentation/screens/employee_shell_screen.dart';
import 'features/employee/presentation/theme/employee_tokens.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Resolve Barlow and Barlow Condensed before the first frame. Without this the
  // app paints one frame in the system face and reflows once the fonts land, which
  // is very visible on the condensed headings.
  await EmployeeTokens.preload();
  runApp(const ProviderScope(child: MonhorusEmployeeApp()));
}

class MonhorusEmployeeApp extends StatelessWidget {
  const MonhorusEmployeeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Monhorus',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      home: const AuthGate(),
    );
  }
}

/// Single routing authority, driven by auth state.
///
/// Declarative rather than imperative on purpose: a screen never calls Navigator to
/// change session state, so there is exactly one place where "which screen should be
/// visible" is decided, and a forced password change cannot be navigated around.
class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthState state = ref.watch(authControllerProvider);

    return switch (state.status) {
      AuthStatus.initialising => const _SplashScreen(),
      AuthStatus.unauthenticated => const LoginScreen(),
      AuthStatus.mustChangePassword => const ChangePasswordScreen(forced: true),
      AuthStatus.authenticated => _landingFor(state.user),
    };
  }

  /// Where a signed-in account starts.
  ///
  /// This build is staff-only. A `customer` account is a valid Monhorus login but
  /// belongs in the customer app, so it is shown a dead end here rather than an
  /// employee shell full of controls the backend would refuse. Role is only the
  /// coarse tier the client routes on; the server's permission checks remain the
  /// real boundary on every request the shell makes.
  Widget _landingFor(AppUser? user) {
    if (user == null) return const _SplashScreen();
    if (user.role == UserRole.customer) return const _CustomerNotSupportedScreen();
    return const EmployeeShellScreen();
  }
}

/// Dead end for a customer account that signed in to the employee build.
class _CustomerNotSupportedScreen extends ConsumerWidget {
  const _CustomerNotSupportedScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool busy = ref.watch(authControllerProvider).busy;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const Icon(
                    Icons.badge_outlined,
                    size: 44,
                    color: EmployeeTokens.muted,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Энэ апп зөвхөн ажилтнуудад зориулагдсан',
                    textAlign: TextAlign.center,
                    style: EmployeeTokens.screenTitle,
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Таны бүртгэл харилцагчийн эрхтэй байна. Харилцагчийн '
                    'Monhorus аппаар нэвтэрнэ үү.',
                    textAlign: TextAlign.center,
                    style: EmployeeTokens.emptyText,
                  ),
                  const SizedBox(height: 28),
                  FilledButton(
                    onPressed: busy
                        ? null
                        : () => ref.read(authControllerProvider.notifier).logout(),
                    child: const Text('Гарах'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text(
              'Monhorus',
              style: EmployeeTokens.display,
            ),
            const SizedBox(height: 20),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
