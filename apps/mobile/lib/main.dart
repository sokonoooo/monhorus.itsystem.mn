import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'features/customer_portal/presentation/theme/customer_tokens.dart';
import 'features/auth/domain/entities/app_user.dart';
import 'features/auth/presentation/providers/auth_provider.dart';
import 'features/auth/presentation/screens/change_password_screen.dart';
import 'features/auth/presentation/screens/home_screen.dart';
import 'features/auth/presentation/screens/login_screen.dart';
import 'features/customer_portal/presentation/screens/customer_shell_screen.dart';
import 'features/user_management/presentation/screens/users_screen.dart';

void main() {
  runApp(const ProviderScope(child: MonhorusApp()));
}

class MonhorusApp extends StatelessWidget {
  const MonhorusApp({super.key});

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
  /// Administrators land on user management, customers on the customer portal, and
  /// everyone else keeps the profile screen they had before. Role is the coarse
  /// tier the mobile client routes on; the backend's permission checks remain the
  /// real boundary on every request either screen makes.
  Widget _landingFor(AppUser? user) {
    if (user == null) return const _SplashScreen();
    if (user.role.isAdmin) return const UsersScreen();
    if (user.role == UserRole.customer) return const CustomerShellScreen();
    return const HomeScreen();
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text('Monhorus', style: CustomerTokens.display),
            SizedBox(height: 20),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
