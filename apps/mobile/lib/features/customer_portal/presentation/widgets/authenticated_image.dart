import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';

/// Renders a stored file that lives behind `GET /files/:fileId`.
///
/// That endpoint returns raw bytes and still requires the Bearer header, so the
/// `downloadUrl` on an attachment or floor plan cannot be handed to
/// `Image.network`; the bytes are fetched through the authenticated Dio client and
/// decoded from memory instead.
class AuthenticatedImage extends ConsumerWidget {
  const AuthenticatedImage({
    super.key,
    required this.fileId,
    this.height,
    this.fit = BoxFit.contain,
  });

  final String fileId;
  final double? height;
  final BoxFit fit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Uint8List> bytes = ref.watch(fileBytesProvider(fileId));

    return SizedBox(
      height: height,
      width: double.infinity,
      child: bytes.when(
        data: (Uint8List data) => Image.memory(
          data,
          fit: fit,
          errorBuilder: (_, __, ___) =>
              const _ImageNotice(text: 'Зургийг уншиж чадсангүй.'),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (Object error, StackTrace _) => _ImageNotice(
          text: error is Failure ? error.message : 'Зураг татаж чадсангүй.',
        ),
      ),
    );
  }
}

class _ImageNotice extends StatelessWidget {
  const _ImageNotice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.all(16),
      color: CustomerTokens.soft2,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.image_not_supported_outlined,
              size: 28, color: CustomerTokens.line),
          const SizedBox(height: 8),
          Text(
            text,
            textAlign: TextAlign.center,
            style: CustomerTokens.rowSub,
          ),
        ],
      ),
    );
  }
}
