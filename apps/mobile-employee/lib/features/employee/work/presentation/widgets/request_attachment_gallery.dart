/// The photographs a customer hung off a service request, as the detail screen shows
/// them.
///
/// WHY THIS IS NOT `Image.network`. `ServiceRequestAttachmentDto.downloadUrl` is
/// `/api/v1/files/:id`, and that route still demands the Bearer header; handing the URL
/// to `Image.network` answers 401 and draws a broken icon. The bytes are fetched through
/// the app's authenticated Dio client instead — the same arrangement the project tab's
/// `AuthenticatedImage` and this tab's evidence strip already use, off the one
/// [workFileBytesProvider] so an image opened twice is fetched once.
///
/// A non-image attachment is LISTED rather than decoded. Intake accepts whatever the
/// customer had to hand, so a PDF must read as a named file the technician knows exists,
/// not as a broken thumbnail.
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../shared/service_request_models.dart';
import '../providers/work_providers.dart';

/// Every attachment on a request: the images as thumbnails that open full-size, the
/// rest as named rows.
class RequestAttachmentGallery extends StatelessWidget {
  const RequestAttachmentGallery({super.key, required this.attachments});

  final List<ServiceRequestAttachmentModel> attachments;

  @override
  Widget build(BuildContext context) {
    final List<ServiceRequestAttachmentModel> images = attachments
        .where((ServiceRequestAttachmentModel a) => a.isImage)
        .toList(growable: false);
    final List<ServiceRequestAttachmentModel> others = attachments
        .where((ServiceRequestAttachmentModel a) => !a.isImage)
        .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (int i = 0; i < images.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(height: 10),
          _AttachmentPhoto(attachment: images[i]),
        ],
        for (int i = 0; i < others.length; i++) ...<Widget>[
          if (i > 0 || images.isNotEmpty) const SizedBox(height: 10),
          _AttachmentFileRow(attachment: others[i]),
        ],
      ],
    );
  }
}

/// One photograph, tall enough to read a fault in and tappable for the full frame.
class _AttachmentPhoto extends StatelessWidget {
  const _AttachmentPhoto({required this.attachment});

  final ServiceRequestAttachmentModel attachment;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      image: true,
      label: attachment.name,
      child: InkWell(
        onTap: () => Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => _AttachmentViewer(attachment: attachment),
          ),
        ),
        child: Container(
          height: 190,
          clipBehavior: Clip.antiAlias,
          decoration: const BoxDecoration(
            color: EmployeeTokens.soft2,
            border: Border.fromBorderSide(
              BorderSide(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
          ),
          child: AuthenticatedFileImage(
            fileId: attachment.id,
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }
}

/// A file that is not an image: its name and nothing pretending to be a preview.
class _AttachmentFileRow extends StatelessWidget {
  const _AttachmentFileRow({required this.attachment});

  final ServiceRequestAttachmentModel attachment;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: const BoxDecoration(
        color: EmployeeTokens.soft2,
        border: Border.fromBorderSide(
          BorderSide(
            color: EmployeeTokens.faint,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      child: Row(
        children: <Widget>[
          const Icon(
            Icons.insert_drive_file_outlined,
            size: 16,
            color: EmployeeTokens.muted,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              attachment.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.ink2),
            ),
          ),
        ],
      ),
    );
  }
}

/// The full-frame view, so a technician can actually see the fault they were sent.
class _AttachmentViewer extends StatelessWidget {
  const _AttachmentViewer({required this.attachment});

  final ServiceRequestAttachmentModel attachment;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EmployeeTokens.hero,
      appBar: AppBar(
        title: Text(attachment.name),
        backgroundColor: EmployeeTokens.hero,
        foregroundColor: EmployeeTokens.onHero,
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 1,
          maxScale: 4,
          child: AuthenticatedFileImage(
            fileId: attachment.id,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
  }
}

/// Renders a stored file that lives behind `GET /files/:fileId`.
///
/// The Ажил tab's sibling of the project tab's `AuthenticatedImage`: same reasoning,
/// different repository, because a feature must not reach across into another's
/// provider graph.
class AuthenticatedFileImage extends ConsumerWidget {
  const AuthenticatedFileImage({
    super.key,
    required this.fileId,
    this.fit = BoxFit.cover,
  });

  final String fileId;
  final BoxFit fit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Uint8List> bytes = ref.watch(workFileBytesProvider(fileId));

    return bytes.when(
      data: (Uint8List data) => Image.memory(
        data,
        fit: fit,
        width: double.infinity,
        // A file whose bytes are not a decodable image must not take the screen down
        // with it; the notice is the honest outcome.
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
            style: EmployeeTokens.microNote,
          ),
        ],
      ),
    );
  }
}
