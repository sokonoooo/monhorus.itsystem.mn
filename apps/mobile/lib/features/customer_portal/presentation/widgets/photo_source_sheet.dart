import 'package:flutter/material.dart';

import '../../../../core/media/photo_capture.dart';
import '../theme/customer_tokens.dart';

/// How a screen obtains one picture, from the tap to the bytes.
///
/// A seam rather than a direct call so a widget test can drive the photo half of a
/// form without a platform channel: `image_picker` has no test binding, and every
/// pick in a test would otherwise come back as [PhotoCaptureFailed].
typedef PortalPhotoPicker = Future<PhotoCaptureResult> Function(BuildContext context);

/// The production [PortalPhotoPicker]: ask where the picture comes from, then take it.
///
/// Dismissing the chooser is a cancel, not a failure, so it collapses into the same
/// [PhotoCaptureCancelled] that backing out of the camera produces and callers need
/// only one silent branch.
Future<PhotoCaptureResult> pickServiceRequestPhoto(BuildContext context) async {
  final PhotoSource? source = await showCustomerPhotoSourceSheet(context);
  if (source == null) return const PhotoCaptureCancelled();
  return capturePhoto(source: source);
}

/// "Зураг хавсаргах" — the camera-or-gallery choice, in the blueprint idiom.
///
/// The same question the employee app asks, in the same words, because it is the same
/// question; only the surface differs. Every value comes from [CustomerTokens], so the
/// square corners and hairline rules follow the rest of the portal rather than being
/// re-decided here.
///
/// Returns null when the sheet is dismissed, which the caller treats as a silent cancel.
Future<PhotoSource?> showCustomerPhotoSourceSheet(BuildContext context) {
  return showModalBottomSheet<PhotoSource>(
    context: context,
    backgroundColor: CustomerTokens.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(CustomerTokens.radiusSheet),
      ),
    ),
    builder: (BuildContext sheetContext) {
      return SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text('Зураг хавсаргах', style: CustomerTokens.headerTitle),
              const SizedBox(height: 4),
              Text(
                'Асуудлыг харуулсан зураг заавал хавсаргана.',
                style: CustomerTokens.rowSub,
              ),
              const SizedBox(height: 14),
              _SourceRow(
                icon: Icons.photo_camera_outlined,
                label: PhotoSource.camera.label,
                detail: 'Одоо байгаа байдлыг шууд бичиж авна.',
                onTap: () => Navigator.of(sheetContext).pop(PhotoSource.camera),
              ),
              const SizedBox(height: 8),
              _SourceRow(
                icon: Icons.photo_library_outlined,
                label: PhotoSource.gallery.label,
                detail: 'Өмнө нь авсан зургаа сонгоно.',
                onTap: () => Navigator.of(sheetContext).pop(PhotoSource.gallery),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => Navigator.of(sheetContext).pop(),
                child: const Text('Болих'),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _SourceRow extends StatelessWidget {
  const _SourceRow({
    required this.icon,
    required this.label,
    required this.detail,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String detail;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        highlightColor: CustomerTokens.accentWashStrong,
        splashColor: CustomerTokens.accentWash,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
          decoration: const BoxDecoration(
            border: Border.fromBorderSide(CustomerTokens.hairlineSide),
          ),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 20, color: CustomerTokens.ink),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(label, style: CustomerTokens.rowTitle),
                    const SizedBox(height: 2),
                    Text(detail, style: CustomerTokens.rowSub),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                size: 18,
                color: CustomerTokens.chevron,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
