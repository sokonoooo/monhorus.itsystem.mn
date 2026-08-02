import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/planned_work_model.dart';
import '../providers/work_providers.dart';

/// The evidence photos on a task, and — when [onAdd] is given — the tile that adds
/// one.
///
/// The strip is used in two places with the same shape but different powers: the task
/// card shows it read-only, because that card is a summary; the progress sheet passes
/// [onAdd], because that is where a technician is already working and where the
/// evidence gate is being closed.
///
/// Uploading is immediate. `POST /planned-work/:id/tasks/:taskId/photos` stores the
/// picture the moment it arrives and re-derives the task's status on the way out, so
/// there is no draft state to hold and nothing for a "Болих" to undo. The sheet says
/// as much next to the strip rather than letting the technician find out.
class EvidencePhotoStrip extends StatelessWidget {
  const EvidencePhotoStrip({
    super.key,
    required this.label,
    required this.photos,
    this.onAdd,
    this.busy = false,
  });

  final String label;
  final List<PlannedWorkPhotoModel> photos;

  /// Null on a read-only strip. Non-null draws the capture tile.
  final VoidCallback? onAdd;

  /// True while this strip's own upload is in flight.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    if (photos.isEmpty && onAdd == null) return const SizedBox.shrink();

    // The capture tile trails the existing photos, so the newest evidence and the
    // control that adds more sit together at the end of the row.
    final int itemCount = photos.length + (onAdd == null ? 0 : 1);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                label.toUpperCase(),
                style: EmployeeTokens.microLabel.copyWith(letterSpacing: 0.5),
              ),
            ),
            if (photos.isNotEmpty)
              Text(
                '${photos.length}',
                style: EmployeeTokens.microLabel.copyWith(letterSpacing: 0),
              ),
          ],
        ),
        const SizedBox(height: 6),
        SizedBox(
          height: 62,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: itemCount,
            separatorBuilder: (BuildContext _, int __) => const SizedBox(width: 7),
            itemBuilder: (BuildContext context, int index) {
              if (index < photos.length) {
                return _PhotoThumb(photo: photos[index]);
              }
              return _AddPhotoTile(busy: busy, onTap: busy ? null : onAdd);
            },
          ),
        ),
      ],
    );
  }
}

/// The capture tile. Disabled — not hidden — while an upload runs, so a slow
/// connection cannot be turned into a queue of duplicate photos by repeated taps.
class _AddPhotoTile extends StatelessWidget {
  const _AddPhotoTile({required this.busy, required this.onTap});

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
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(
                      Icons.add_a_photo_outlined,
                      size: 18,
                      color:
                          onTap == null ? EmployeeTokens.muted : EmployeeTokens.ink,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Нэмэх',
                      style: EmployeeTokens.microLabel.copyWith(letterSpacing: 0),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _PhotoThumb extends ConsumerWidget {
  const _PhotoThumb({required this.photo});

  final PlannedWorkPhotoModel photo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Uint8List> bytes =
        ref.watch(workFileBytesProvider(photo.id));

    return Container(
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
          // A file whose bytes are not a decodable image must not take the screen
          // down with it; the placeholder is the honest outcome.
          errorBuilder: (BuildContext _, Object __, StackTrace? ___) =>
              const _ThumbPlaceholder(icon: Icons.broken_image_outlined),
        ),
        loading: () => const Center(
          child: SizedBox(
            width: 15,
            height: 15,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
        error: (Object _, StackTrace __) =>
            const _ThumbPlaceholder(icon: Icons.image_not_supported_outlined),
      ),
    );
  }
}

class _ThumbPlaceholder extends StatelessWidget {
  const _ThumbPlaceholder({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Icon(icon, size: 18, color: EmployeeTokens.muted),
    );
  }
}
