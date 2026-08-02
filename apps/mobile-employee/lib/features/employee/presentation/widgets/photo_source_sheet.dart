import 'package:flutter/material.dart';

import '../../../../core/media/photo_capture.dart';
import '../theme/employee_tokens.dart';

/// "Зураг хаанаас авах вэ?" — the camera-or-gallery choice, as the prototype's sheet.
///
/// Shared by the Ажил tab's evidence photos and the Төсөл tab's үнэлгээ evidence, so
/// both flows ask the same question in the same words. Returns null when the sheet is
/// dismissed, which every caller treats as a silent cancel.
Future<PhotoSource?> showPhotoSourceSheet(BuildContext context) {
  return showModalBottomSheet<PhotoSource>(
    context: context,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (BuildContext sheetContext) {
      return Container(
        decoration: const BoxDecoration(
          color: EmployeeTokens.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(EmployeeTokens.radiusSheet),
          ),
          border: Border(
            top: BorderSide(
              color: EmployeeTokens.line,
              width: EmployeeTokens.hairline,
            ),
          ),
        ),
        padding: EdgeInsets.fromLTRB(
          16,
          10,
          16,
          14 + MediaQuery.viewPaddingOf(sheetContext).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: EmployeeTokens.line,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Text(
              'Зураг хавсаргах',
              style: EmployeeTokens.headerTitle.copyWith(
                fontWeight: FontWeight.w900,
              ),
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
            const SizedBox(height: 12),
            TextButton(
              onPressed: () => Navigator.of(sheetContext).pop(),
              child: Text(
                'Болих',
                style: EmployeeTokens.rowTitle.copyWith(
                  fontWeight: FontWeight.w700,
                  color: EmployeeTokens.muted,
                ),
              ),
            ),
          ],
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
      color: EmployeeTokens.white,
      borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
            border: Border.all(
              color: EmployeeTokens.line,
              width: EmployeeTokens.hairline,
            ),
          ),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 20, color: EmployeeTokens.ink),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      label,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: EmployeeTokens.ink,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      detail,
                      style: const TextStyle(
                        fontSize: 10.5,
                        color: EmployeeTokens.muted,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                size: 19,
                color: EmployeeTokens.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
