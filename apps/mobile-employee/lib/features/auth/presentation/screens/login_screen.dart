import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../employee/presentation/theme/employee_tokens.dart';
import '../providers/auth_provider.dart';
import '../widgets/auth_text_field.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _obscurePassword = true;
  String? _emailError;
  String? _passwordError;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// Client-side pre-check only. The backend remains the authority on validity.
  bool _validate() {
    final String email = _emailController.text.trim();
    final String password = _passwordController.text;

    setState(() {
      _emailError = email.isEmpty
          ? 'Имэйл заавал.'
          : (!email.contains('@') ? 'Имэйл хаяг буруу форматтай байна.' : null);
      _passwordError = password.isEmpty ? 'Нууц үг заавал.' : null;
    });

    return _emailError == null && _passwordError == null;
  }

  Future<void> _submit() async {
    if (!_validate()) return;

    FocusScope.of(context).unfocus();

    await ref.read(authControllerProvider.notifier).login(
          email: _emailController.text.trim(),
          password: _passwordController.text,
        );
    // Navigation is driven by AuthGate watching authControllerProvider, so there is
    // deliberately no Navigator call here.
  }

  /// Field-level errors from the API take precedence over the local pre-check.
  String? _serverFieldError(Failure? failure, String field) {
    if (failure is ServerFailure) return failure.fieldErrors[field];
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final AuthState state = ref.watch(authControllerProvider);
    final Failure? failure = state.failure;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  const _BrandMark(),
                  const SizedBox(height: 18),
                  Text(
                    'Monhorus',
                    textAlign: TextAlign.center,
                    style: EmployeeTokens.display,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Цахилгааны үйлчилгээний удирдлагын систем',
                    textAlign: TextAlign.center,
                    style: EmployeeTokens.emptyText,
                  ),
                  const SizedBox(height: 28),

                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'Нэвтрэх',
                            style: EmployeeTokens.screenTitle,
                          ),
                          const SizedBox(height: 16),

                          if (failure != null) ...<Widget>[
                            _ErrorBanner(message: failure.message),
                            const SizedBox(height: 16),
                          ],

                          AuthTextField(
                            label: 'Имэйл',
                            controller: _emailController,
                            hintText: 'name@company.mn',
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autofillHints: const <String>[AutofillHints.username],
                            enabled: !state.busy,
                            errorText: _emailError ?? _serverFieldError(failure, 'email'),
                          ),
                          const SizedBox(height: 16),

                          AuthTextField(
                            label: 'Нууц үг',
                            controller: _passwordController,
                            obscureText: _obscurePassword,
                            textInputAction: TextInputAction.done,
                            autofillHints: const <String>[AutofillHints.password],
                            enabled: !state.busy,
                            errorText:
                                _passwordError ?? _serverFieldError(failure, 'password'),
                            onSubmitted: (_) => _submit(),
                            suffix: IconButton(
                              onPressed: () =>
                                  setState(() => _obscurePassword = !_obscurePassword),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                                size: 20,
                              ),
                              tooltip: _obscurePassword ? 'Харах' : 'Нуух',
                            ),
                          ),
                          const SizedBox(height: 24),

                          FilledButton(
                            // The only branded control on the screen. The rest of the app
                            // keeps the shared accent; see the token's own note.
                            style: FilledButton.styleFrom(
                              backgroundColor: EmployeeTokens.brand,
                              foregroundColor: EmployeeTokens.white,
                              disabledBackgroundColor:
                                  EmployeeTokens.brand.withValues(alpha: 0.45),
                              disabledForegroundColor:
                                  EmployeeTokens.white.withValues(alpha: 0.85),
                            ),
                            onPressed: state.busy ? null : _submit,
                            child: state.busy
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: EmployeeTokens.white,
                                    ),
                                  )
                                : const Text('Нэвтрэх'),
                          ),

                          const SizedBox(height: 20),
                          const Divider(height: 1),
                          const SizedBox(height: 16),

                          // V1 has no self-service recovery. Saying so here avoids
                          // support tickets asking for the missing link.
                          Text(
                            'Нууц үгээ мартсан бол системийн администратортой '
                            'холбогдоно уу. Өөрөө сэргээх боломжгүй.',
                            textAlign: TextAlign.center,
                            style: EmployeeTokens.rowSub,
                          ),
                        ],
                      ),
                    ),
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

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: EmployeeTokens.redBg,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        border: Border.all(
          color: EmployeeTokens.redBorder,
          width: EmployeeTokens.hairline,
        ),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.error_outline, color: EmployeeTokens.red, size: 20),
          const SizedBox(width: 10),
          Expanded(
            // Ink on the tint, not red on red: the icon carries the severity and the
            // message has to stay legible.
            child: Text(message, style: EmployeeTokens.body),
          ),
        ],
      ),
    );
  }
}

/// The launcher icon, over a wash of its own colour.
///
/// The sign-in screen is the one place a person may be unsure WHICH of the two apps they
/// opened — the forms are near enough identical and the product name is the same on both.
/// Showing the icon they just tapped, in the colour they just tapped, answers that before
/// they read a word. Everything past this screen keeps the shared accent.
class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          // A tint rather than a solid disc: at full strength the field colour competes
          // with the icon sitting on it, which is the same colour.
          color: EmployeeTokens.brand.withValues(alpha: 0.12),
        ),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: EmployeeTokens.brandDeep.withValues(alpha: 0.28),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Image.asset(
              'assets/brand/app_icon.png',
              width: 76,
              height: 76,
              fit: BoxFit.cover,
            ),
          ),
        ),
      ),
    );
  }
}
