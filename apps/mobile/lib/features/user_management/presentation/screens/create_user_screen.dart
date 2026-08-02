import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/error/failure.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/widgets/auth_text_field.dart';
import '../../../customer_portal/presentation/theme/customer_tokens.dart';
import '../../../customer_portal/presentation/widgets/customer_ui.dart';
import '../../data/models/create_user_request.dart';
import '../providers/user_management_provider.dart';
import '../widgets/passcode_result_sheet.dart';

/// Admin-only account provisioning. This is the sole way an account comes into
/// existence; there is no self-registration screen anywhere in the app.
class CreateUserScreen extends ConsumerStatefulWidget {
  const CreateUserScreen({super.key});

  @override
  ConsumerState<CreateUserScreen> createState() => _CreateUserScreenState();
}

class _CreateUserScreenState extends ConsumerState<CreateUserScreen> {
  final TextEditingController _fullNameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  late final TextEditingController _passwordController =
      TextEditingController(text: generatePasscode());

  UserRole? _role;
  bool _submitting = false;
  String? _formError;
  final Map<String, String> _fieldErrors = <String, String>{};

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  bool _validate() {
    final String fullName = _fullNameController.text.trim();
    final String email = _emailController.text.trim();
    final String phone = _phoneController.text.trim();
    final String password = _passwordController.text;

    _fieldErrors.clear();

    if (fullName.length < 2) {
      _fieldErrors['fullName'] = 'Нэр дор хаяж 2 тэмдэгттэй байна.';
    }
    if (email.isEmpty || !email.contains('@')) {
      _fieldErrors['email'] = 'Имэйл хаяг буруу форматтай байна.';
    }
    if (phone.isNotEmpty && !RegExp(r'^(\+976)?[- ]?\d{4}[- ]?\d{4}$').hasMatch(phone)) {
      _fieldErrors['phone'] = 'Утасны дугаар буруу форматтай байна.';
    }
    if (_role == null) {
      _fieldErrors['role'] = 'Эрх заавал сонгоно.';
    }
    if (password.length < AppConfig.passwordMinLength ||
        !RegExp(r'[A-Za-zА-Яа-яӨөҮү]').hasMatch(password) ||
        !RegExp(r'\d').hasMatch(password)) {
      _fieldErrors['password'] =
          'Дор хаяж ${AppConfig.passwordMinLength} тэмдэгт, нэг үсэг, нэг тоо.';
    }

    setState(() {});
    return _fieldErrors.isEmpty;
  }

  Future<void> _submit() async {
    if (!_validate()) return;

    FocusScope.of(context).unfocus();
    setState(() {
      _submitting = true;
      _formError = null;
    });

    final ProvisionedUser? result =
        await ref.read(userListControllerProvider.notifier).createUser(
              CreateUserRequest(
                fullName: _fullNameController.text.trim(),
                email: _emailController.text.trim(),
                password: _passwordController.text,
                phone: _phoneController.text.trim(),
                role: _role!,
              ),
            );

    if (!mounted) return;

    if (result == null) {
      final Failure? failure = ref.read(userListControllerProvider).failure;
      setState(() {
        _submitting = false;
        _formError = failure?.message ?? 'Хэрэглэгч үүсгэхэд алдаа гарлаа.';
        if (failure is ServerFailure) {
          _fieldErrors.addAll(failure.fieldErrors);
        }
      });
      return;
    }

    Navigator.of(context).pop();
    await PasscodeResultSheet.show(
      context,
      provisioned: result,
      title: 'Хэрэглэгч үүслээ',
      description: '${result.user.fullName} (${result.user.email}) бүртгэгдлээ.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppUser? actor = ref.watch(currentUserProvider);

    // A plain admin cannot mint another administrator, matching the backend guard.
    final List<UserRole> availableRoles = UserRole.values
        .where((UserRole role) => actor?.canCreateRole(role) ?? false)
        .toList(growable: false);

    return Scaffold(
      appBar: AppBar(title: const Text('Шинэ хэрэглэгч')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (_formError != null) ...<Widget>[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: CustomerTokens.card(
                    fill: CustomerTokens.redBg,
                    border: CustomerTokens.redBorder,
                    radius: CustomerTokens.radiusRow,
                  ),
                  child: Text(
                    _formError!,
                    style: CustomerTokens.body.copyWith(
                      color: CustomerTokens.ink,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],

              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      AuthTextField(
                        label: 'Бүтэн нэр',
                        controller: _fullNameController,
                        enabled: !_submitting,
                        errorText: _fieldErrors['fullName'],
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        label: 'Имэйл',
                        controller: _emailController,
                        hintText: 'name@company.mn',
                        keyboardType: TextInputType.emailAddress,
                        enabled: !_submitting,
                        errorText: _fieldErrors['email'],
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 16),
                      AuthTextField(
                        label: 'Утас',
                        controller: _phoneController,
                        hintText: '9911-2233',
                        keyboardType: TextInputType.phone,
                        enabled: !_submitting,
                        errorText: _fieldErrors['phone'],
                        helperText: 'Сонголттой.',
                      ),
                      const SizedBox(height: 16),

                      const FieldLabel('Эрх'),
                      DropdownButtonFormField<UserRole>(
                        initialValue: _role,
                        decoration: InputDecoration(
                          hintText: 'Эрх сонгоно уу',
                          errorText: _fieldErrors['role'],
                        ),
                        items: availableRoles
                            .map(
                              (UserRole role) => DropdownMenuItem<UserRole>(
                                value: role,
                                child: Text(role.label),
                              ),
                            )
                            .toList(growable: false),
                        onChanged: _submitting
                            ? null
                            : (UserRole? value) => setState(() => _role = value),
                      ),
                      const SizedBox(height: 16),

                      AuthTextField(
                        label: 'Түр нууц үг',
                        controller: _passwordController,
                        enabled: !_submitting,
                        errorText: _fieldErrors['password'],
                      ),
                      const SizedBox(height: 6),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton.icon(
                          onPressed: _submitting
                              ? null
                              : () => setState(
                                    () => _passwordController.text = generatePasscode(),
                                  ),
                          icon: const Icon(Icons.refresh, size: 17),
                          label: const Text('Шинээр үүсгэх'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 16),
              if (actor?.role == UserRole.admin)
                const NoticeBanner.info(
                  text: 'Админ болон ерөнхий админ эрхтэй хэрэглэгчийг зөвхөн '
                      'ерөнхий админ үүсгэнэ.',
                ),

              const SizedBox(height: 20),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: CustomerTokens.white,
                        ),
                      )
                    : const Text('Үүсгэх'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
