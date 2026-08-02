import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/error/failure.dart';
import '../../../employee/presentation/theme/employee_tokens.dart';
import '../providers/auth_provider.dart';
import '../widgets/auth_text_field.dart';

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key, this.forced = false});

  /// True when reached because status is must_change_password, in which case the
  /// screen cannot be dismissed.
  final bool forced;

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final TextEditingController _currentController = TextEditingController();
  final TextEditingController _newController = TextEditingController();
  final TextEditingController _confirmController = TextEditingController();

  String? _currentError;
  String? _newError;
  String? _confirmError;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  /// Mirrors the backend policy so the user is not round-tripped for an obvious miss.
  bool _validate() {
    final String current = _currentController.text;
    final String next = _newController.text;
    final String confirm = _confirmController.text;

    String? newError;
    if (next.length < AppConfig.passwordMinLength) {
      newError = 'Нууц үг дор хаяж ${AppConfig.passwordMinLength} тэмдэгттэй байна.';
    } else if (!RegExp(r'[A-Za-zА-Яа-яӨөҮү]').hasMatch(next)) {
      newError = 'Нууц үг дор хаяж нэг үсэг агуулна.';
    } else if (!RegExp(r'\d').hasMatch(next)) {
      newError = 'Нууц үг дор хаяж нэг тоо агуулна.';
    } else if (next == current) {
      newError = 'Шинэ нууц үг өмнөхөөсөө ялгаатай байна.';
    }

    setState(() {
      _currentError = current.isEmpty ? 'Одоогийн нууц үг заавал.' : null;
      _newError = newError;
      _confirmError = confirm != next ? 'Нууц үг таарахгүй байна.' : null;
    });

    return _currentError == null && _newError == null && _confirmError == null;
  }

  Future<void> _submit() async {
    if (!_validate()) return;

    FocusScope.of(context).unfocus();

    final bool changed = await ref.read(authControllerProvider.notifier).changePassword(
          currentPassword: _currentController.text,
          newPassword: _newController.text,
        );

    if (!mounted) return;

    if (changed) {
      // Every session was revoked server-side, so the controller has already moved
      // to unauthenticated and AuthGate will show the login screen.
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Нууц үг солигдлоо. Шинэ нууц үгээрээ нэвтэрнэ үү.'),
          backgroundColor: EmployeeTokens.green,
        ),
      );

      // AuthGate swaps the FIRST route, so a screen that was *pushed* on top of it
      // — as the Профайл tab's "Нууц үг солих" row does — would otherwise stay
      // mounted over the login screen, leaving a dead form the user cannot get past.
      // A forced change is never pushed; it is the root, and popping it would empty
      // the navigator.
      if (!widget.forced) {
        await Navigator.of(context).maybePop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AuthState state = ref.watch(authControllerProvider);
    final Failure? failure = state.failure;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Нууц үг солих'),
        automaticallyImplyLeading: !widget.forced,
        actions: <Widget>[
          if (widget.forced)
            TextButton(
              onPressed: () => ref.read(authControllerProvider.notifier).logout(),
              child: const Text('Гарах'),
            ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  if (widget.forced) ...<Widget>[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: EmployeeTokens.yellowBg,
                        borderRadius: BorderRadius.circular(
                          EmployeeTokens.radiusInput,
                        ),
                        border: Border.all(
                          color: EmployeeTokens.yellowBorder,
                          width: EmployeeTokens.hairline,
                        ),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Icon(
                            Icons.warning_amber_rounded,
                            color: EmployeeTokens.yellow,
                            size: 20,
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            // Ink on the tint: `yellow` does not reach 4.5:1 on this
                            // wash, and the icon already carries the severity.
                            child: Text(
                              'Администратор танд түр нууц үг олгосон байна. '
                              'Үргэлжлүүлэхийн тулд шинэ нууц үг тохируулна уу.',
                              style: EmployeeTokens.body,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],

                  if (failure != null) ...<Widget>[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: EmployeeTokens.redBg,
                        borderRadius: BorderRadius.circular(
                          EmployeeTokens.radiusInput,
                        ),
                        border: Border.all(
                          color: EmployeeTokens.redBorder,
                          width: EmployeeTokens.hairline,
                        ),
                      ),
                      child: Text(failure.message, style: EmployeeTokens.body),
                    ),
                    const SizedBox(height: 16),
                  ],

                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          AuthTextField(
                            label: 'Одоогийн нууц үг',
                            controller: _currentController,
                            obscureText: true,
                            enabled: !state.busy,
                            errorText: _currentError,
                            autofillHints: const <String>[AutofillHints.password],
                          ),
                          const SizedBox(height: 16),
                          AuthTextField(
                            label: 'Шинэ нууц үг',
                            controller: _newController,
                            obscureText: true,
                            enabled: !state.busy,
                            errorText: _newError,
                            helperText: 'Дор хаяж 10 тэмдэгт, нэг үсэг, нэг тоо.',
                            autofillHints: const <String>[AutofillHints.newPassword],
                          ),
                          const SizedBox(height: 16),
                          AuthTextField(
                            label: 'Шинэ нууц үг давтах',
                            controller: _confirmController,
                            obscureText: true,
                            enabled: !state.busy,
                            errorText: _confirmError,
                            autofillHints: const <String>[AutofillHints.newPassword],
                          ),
                          const SizedBox(height: 24),
                          FilledButton(
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
                                : const Text('Нууц үг солих'),
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
