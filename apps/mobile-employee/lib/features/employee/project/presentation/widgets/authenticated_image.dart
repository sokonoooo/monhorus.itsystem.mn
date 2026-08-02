import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../providers/project_providers.dart';

/// Renders a stored file that lives behind `GET /files/:fileId`.
///
/// That endpoint returns raw bytes and still requires the Bearer header, so the
/// `downloadUrl` on a floor plan or a device photo cannot be handed to
/// `Image.network`; the bytes are fetched through the authenticated Dio client and
/// decoded from memory instead.
///
/// The permission the server checks is chosen by the file's owner type — `object.view`
/// for a FLOOR_PLAN, `object_master.view` for an OBJECT photo — so a caller who can
/// read a screen can always read the images on it.
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
    final AsyncValue<Uint8List> bytes = ref.watch(projectFileBytesProvider(fileId));

    return SizedBox(
      height: height,
      width: double.infinity,
      child: bytes.when(
        data: (Uint8List data) => Image.memory(
          data,
          fit: fit,
          errorBuilder: (BuildContext _, Object __, StackTrace? ___) =>
              const _ImageNotice(text: 'Зургийг уншиж чадсангүй.'),
        ),
        loading: () => const Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2.2),
          ),
        ),
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
      color: EmployeeTokens.soft2,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(
            Icons.image_not_supported_outlined,
            size: 26,
            color: EmployeeTokens.line,
          ),
          const SizedBox(height: 8),
          Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11, color: EmployeeTokens.muted),
          ),
        ],
      ),
    );
  }
}
