import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../customer_portal/presentation/theme/customer_tokens.dart';
import '../../data/models/create_user_request.dart';

/// Shows a freshly issued passcode exactly once.
///
/// The backend stores only the bcrypt hash, so this value is unrecoverable after the
/// sheet closes. The copy states that plainly to stop an admin from dismissing it and
/// then asking where the passcode went.
class PasscodeResultSheet extends StatelessWidget {
  const PasscodeResultSheet({
    required this.provisioned,
    required this.title,
    required this.description,
    super.key,
  });

  final ProvisionedUser provisioned;
  final String title;
  final String description;

  static Future<void> show(
    BuildContext context, {
    required ProvisionedUser provisioned,
    required String title,
    required String description,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      isScrollControlled: true,
      builder: (BuildContext ctx) => PasscodeResultSheet(
        provisioned: provisioned,
        title: title,
        description: description,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                const Icon(Icons.check_circle_outline,
                    color: CustomerTokens.green),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(title, style: CustomerTokens.headerTitle),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(description, style: CustomerTokens.body),
            const SizedBox(height: 16),

            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: CustomerTokens.card(
                fill: CustomerTokens.paper,
                border: CustomerTokens.faint,
                radius: CustomerTokens.radiusRow,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text('ТҮР НУУЦ ҮГ', style: CustomerTokens.sectionLabel),
                  const SizedBox(height: 8),
                  SelectableText(
                    provisioned.temporaryPassword,
                    style: CustomerTokens.monoFigure,
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(
                          ClipboardData(text: provisioned.temporaryPassword),
                        );
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Нууц үг хуулагдлаа.')),
                        );
                      },
                      icon: const Icon(Icons.copy_outlined, size: 17),
                      label: const Text('Хуулах'),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: CustomerTokens.card(
                fill: CustomerTokens.yellowBg,
                border: CustomerTokens.yellowBorder,
                radius: CustomerTokens.radiusRow,
              ),
              child: Text(
                'Энэ нууц үг дахин харагдахгүй. Хэрэглэгчид аюулгүй сувгаар '
                'дамжуулна уу. Тэрээр дараагийн нэвтрэлтээр заавал нууц үгээ солино.',
                style: CustomerTokens.body.copyWith(color: CustomerTokens.ink),
              ),
            ),

            const SizedBox(height: 20),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Хаах'),
            ),
          ],
        ),
      ),
    );
  }
}
