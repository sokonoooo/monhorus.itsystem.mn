import 'package:flutter/material.dart';

import '../../../employee/presentation/theme/employee_tokens.dart';

/// Labelled text field with inline error support, used across the auth screens.
class AuthTextField extends StatelessWidget {
  const AuthTextField({
    required this.label,
    required this.controller,
    super.key,
    this.hintText,
    this.errorText,
    this.helperText,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.enabled = true,
    this.suffix,
    this.onSubmitted,
  });

  final String label;
  final TextEditingController controller;
  final String? hintText;
  final String? errorText;
  final String? helperText;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final bool enabled;
  final Widget? suffix;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: EmployeeTokens.rowTitle,
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          obscureText: obscureText,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          autofillHints: autofillHints,
          enabled: enabled,
          onSubmitted: onSubmitted,
          decoration: InputDecoration(
            hintText: hintText,
            errorText: errorText,
            helperText: helperText,
            suffixIcon: suffix,
          ),
        ),
      ],
    );
  }
}
