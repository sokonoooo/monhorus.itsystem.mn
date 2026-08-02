import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/error/failure.dart';
import '../../../customer_portal/presentation/theme/customer_tokens.dart';
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
        ),
      );
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
                      decoration: CustomerTokens.card(
                        fill: CustomerTokens.yellowBg,
                        border: CustomerTokens.yellowBorder,
                        radius: CustomerTokens.radiusRow,
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          const Icon(Icons.warning_amber_rounded,
                              color: CustomerTokens.yellow, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Администратор танд түр нууц үг олгосон байна. '
                              'Үргэлжлүүлэхийн тулд шинэ нууц үг тохируулна уу.',
                              style: CustomerTokens.body.copyWith(
                                color: CustomerTokens.ink,
                              ),
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
                      decoration: CustomerTokens.card(
                        fill: CustomerTokens.redBg,
                        border: CustomerTokens.redBorder,
                        radius: CustomerTokens.radiusRow,
                      ),
                      child: Text(
                        failure.message,
                        style: CustomerTokens.body.copyWith(
                          color: CustomerTokens.ink,
                        ),
                      ),
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
                                      color: CustomerTokens.white,
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
