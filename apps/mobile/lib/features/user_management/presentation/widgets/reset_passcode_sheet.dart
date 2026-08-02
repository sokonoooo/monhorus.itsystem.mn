import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/widgets/auth_text_field.dart';
import '../../../customer_portal/presentation/theme/customer_tokens.dart';
import '../../data/models/create_user_request.dart';
import '../providers/user_management_provider.dart';
import 'passcode_result_sheet.dart';

/// Administrative passcode reset, the only recovery path in V1.
///
/// The copy states both side effects explicitly, because they are surprising: the
/// target is signed out of every device, and must change the passcode at next login.
class ResetPasscodeSheet extends ConsumerStatefulWidget {
  const ResetPasscodeSheet({required this.target, super.key});

  final AppUser target;

  static Future<void> show(BuildContext context, AppUser target) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: ResetPasscodeSheet(target: target),
      ),
    );
  }

  @override
  ConsumerState<ResetPasscodeSheet> createState() => _ResetPasscodeSheetState();
}

class _ResetPasscodeSheetState extends ConsumerState<ResetPasscodeSheet> {
  late final TextEditingController _passwordController =
      TextEditingController(text: generatePasscode());
  final TextEditingController _reasonController = TextEditingController();

  bool _submitting = false;
  String? _passwordError;
  String? _formError;

  @override
  void dispose() {
    _passwordController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  bool _validate() {
    final String value = _passwordController.text;
    String? error;

    if (value.length < AppConfig.passwordMinLength) {
      error = 'Дор хаяж ${AppConfig.passwordMinLength} тэмдэгт байна.';
    } else if (!RegExp(r'[A-Za-zА-Яа-яӨөҮү]').hasMatch(value)) {
      error = 'Дор хаяж нэг үсэг агуулна.';
    } else if (!RegExp(r'\d').hasMatch(value)) {
      error = 'Дор хаяж нэг тоо агуулна.';
    }

    setState(() => _passwordError = error);
    return error == null;
  }

  Future<void> _submit() async {
    if (!_validate()) return;

    setState(() {
      _submitting = true;
      _formError = null;
    });

    final ProvisionedUser? result =
        await ref.read(userListControllerProvider.notifier).resetPasscode(
              widget.target.id,
              ResetPasscodeRequest(
                newPassword: _passwordController.text,
                reason: _reasonController.text.trim().isEmpty
                    ? null
                    : _reasonController.text.trim(),
              ),
            );

    if (!mounted) return;

    if (result == null) {
      setState(() {
        _submitting = false;
        _formError = ref.read(userListControllerProvider).failure?.message ??
            'Нууц үг шинэчлэхэд алдаа гарлаа.';
      });
      return;
    }

    Navigator.of(context).pop();
    await PasscodeResultSheet.show(
      context,
      provisioned: result,
      title: 'Нууц үг шинэчлэгдлээ',
      description:
          '${result.user.fullName}-ийн нууц үг шинэчлэгдэж, бүх идэвхтэй сесс цуцлагдлаа.',
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Нууц үг шинэчлэх', style: CustomerTokens.headerTitle),
            const SizedBox(height: 14),

            Container(
              padding: const EdgeInsets.all(12),
              decoration: CustomerTokens.card(
                fill: CustomerTokens.paper,
                border: CustomerTokens.faint,
                radius: CustomerTokens.radiusRow,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(widget.target.fullName, style: CustomerTokens.cardTitle),
                  Text(
                    widget.target.email,
                    style: CustomerTokens.body.copyWith(
                      color: CustomerTokens.muted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            Container(
              padding: const EdgeInsets.all(12),
              decoration: CustomerTokens.card(
                fill: CustomerTokens.yellowBg,
                border: CustomerTokens.yellowBorder,
                radius: CustomerTokens.radiusRow,
              ),
              child: Text(
                'Тухайн хэрэглэгчийн бүх идэвхтэй сесс цуцлагдаж, дараагийн '
                'нэвтрэлтээр нууц үгээ заавал солих шаардлагатай болно.',
                style: CustomerTokens.body.copyWith(color: CustomerTokens.ink),
              ),
            ),
            const SizedBox(height: 16),

            if (_formError != null) ...<Widget>[
              Text(
                _formError!,
                style: CustomerTokens.body.copyWith(color: CustomerTokens.red),
              ),
              const SizedBox(height: 12),
            ],

            AuthTextField(
              label: 'Шинэ түр нууц үг',
              controller: _passwordController,
              enabled: !_submitting,
              errorText: _passwordError,
            ),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _submitting
                    ? null
                    : () => setState(() {
                          _passwordController.text = generatePasscode();
                          _passwordError = null;
                        }),
                icon: const Icon(Icons.refresh, size: 17),
                label: const Text('Шинээр үүсгэх'),
              ),
            ),
            const SizedBox(height: 10),

            AuthTextField(
              label: 'Шалтгаан',
              controller: _reasonController,
              enabled: !_submitting,
              helperText: 'Сонголттой. Audit log-д хадгалагдана.',
            ),
            const SizedBox(height: 22),

            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: _submitting ? null : () => Navigator.of(context).pop(),
                    child: const Text('Цуцлах'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: _submitting ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: CustomerTokens.red,
                    ),
                    child: _submitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: CustomerTokens.white,
                            ),
                          )
                        : const Text('Шинэчлэх'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
