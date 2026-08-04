import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../providers/work_providers.dart';
import 'work_ui.dart';

/// A row of conclusion evidence, by photo id, with the tile that adds one.
///
/// Used for all three of the conclusion's photo sets — the visit's "before", the visit's
/// "after", and each piece of equipment's own — because they differ only in what they are
/// called and where their ids are stored. They were previously one private widget inside
/// the equipment card, which is why the visit-level pair had no control at all: the
/// requirement existed server-side with nothing on screen to satisfy it.
///
/// The DTO returns ids only, so bytes are fetched through the authenticated client by id.
/// No raw or public URL is ever built or shown.
class ReportPhotoStrip extends ConsumerWidget {
  const ReportPhotoStrip({
    super.key,
    required this.label,
    required this.photoIds,
    required this.busy,
    this.required = false,
    this.onAdd,
    this.onRemove,
  });

  /// Printed above the row, WITHOUT the count — the count is appended here so every strip
  /// reads the same way.
  final String label;
  final List<String> photoIds;

  /// This strip's own upload is in flight.
  final bool busy;

  /// Marks a strip the server will refuse an empty submission over. Drawn as a word rather
  /// than an asterisk: an asterisk is a convention a technician has to already know.
  final bool required;

  final VoidCallback? onAdd;
  final ValueChanged<String>? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (photoIds.isEmpty && onAdd == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(child: FieldLabel('$label (${photoIds.length})')),
            if (required && photoIds.isEmpty)
              Text('Заавал', style: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.red)),
          ],
        ),
        SizedBox(
          height: 62,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: photoIds.length + (onAdd == null ? 0 : 1),
            separatorBuilder: (BuildContext _, int __) => const SizedBox(width: 7),
            itemBuilder: (BuildContext context, int index) {
              if (index < photoIds.length) {
                final String id = photoIds[index];
                return _Thumb(
                  photoId: id,
                  onRemove: onRemove == null ? null : () => onRemove!(id),
                );
              }
              return _AddTile(busy: busy, onTap: busy ? null : onAdd);
            },
          ),
        ),
      ],
    );
  }
}

class _Thumb extends ConsumerWidget {
  const _Thumb({required this.photoId, this.onRemove});

  final String photoId;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Uint8List> bytes = ref.watch(workFileBytesProvider(photoId));

    return Stack(
      children: <Widget>[
        Container(
          width: 62,
          height: 62,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: EmployeeTokens.soft2,
            border: Border.all(color: EmployeeTokens.faint),
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          ),
          child: bytes.when(
            data: (Uint8List data) => Image.memory(
              data,
              fit: BoxFit.cover,
              errorBuilder: (BuildContext _, Object __, StackTrace? ___) =>
                  const Icon(Icons.broken_image_outlined, size: 18),
            ),
            loading: () => const Center(
              child: SizedBox(
                width: 15,
                height: 15,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
            error: (Object _, StackTrace __) =>
                const Icon(Icons.image_not_supported_outlined, size: 18),
          ),
        ),
        if (onRemove != null)
          Positioned(
            top: -6,
            right: -6,
            child: IconButton(
              onPressed: onRemove,
              icon: const Icon(Icons.cancel, size: 18),
              tooltip: 'Зураг хасах',
              visualDensity: VisualDensity.compact,
            ),
          ),
      ],
    );
  }
}

class _AddTile extends StatelessWidget {
  const _AddTile({required this.busy, required this.onTap});

  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: EmployeeTokens.white,
      borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: Container(
          width: 62,
          height: 62,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border.all(
              color: onTap == null ? EmployeeTokens.faint : EmployeeTokens.line,
              width: EmployeeTokens.hairline,
            ),
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          ),
          child: busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add_a_photo_outlined, size: 18),
        ),
      ),
    );
  }
}
