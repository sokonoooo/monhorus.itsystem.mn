import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../project/domain/entities/risk_level.dart';
import '../providers/conclusion_providers.dart';
import '../providers/work_providers.dart';
import 'work_ui.dart';

/// One piece of equipment being assessed, as an expandable card.
///
/// Collapsed by default once there are several, because a service visit that covers six
/// panels is otherwise a single scroll of identical fields with no way to tell where one
/// device ends and the next begins. The header carries enough to identify the object
/// without expanding it — code, name, type, floor, its current standing and whether this
/// visit has said anything yet — which is what stops a finding being typed against the
/// wrong panel.
///
/// Values live in [EquipmentDraft], not in this widget. The controllers are seeded once
/// and every keystroke is reported upward, so collapsing a card, adding another or
/// scrolling away cannot lose what was typed.
class EquipmentAssessmentCard extends ConsumerStatefulWidget {
  const EquipmentAssessmentCard({
    super.key,
    required this.draft,
    required this.editable,
    required this.uploading,
    required this.onChanged,
    this.error,
    this.onRemove,
    this.onAddPhoto,
    this.onRemovePhoto,
  });

  final EquipmentDraft draft;
  final bool editable;

  /// This card's own upload is in flight. Only this card shows progress.
  final bool uploading;

  /// The server's refusal for this object, printed against the card it belongs to.
  final String? error;

  final void Function(
    String? score,
    String? observation,
    String? conclusion,
    String? recommendation,
  ) onChanged;

  final VoidCallback? onRemove;
  final VoidCallback? onAddPhoto;
  final ValueChanged<String>? onRemovePhoto;

  @override
  ConsumerState<EquipmentAssessmentCard> createState() => _EquipmentAssessmentCardState();
}

class _EquipmentAssessmentCardState extends ConsumerState<EquipmentAssessmentCard> {
  late final TextEditingController _score;
  late final TextEditingController _observation;
  late final TextEditingController _conclusion;
  late final TextEditingController _recommendation;
  bool _expanded = false;

  @override
  void initState() {
    super.initState();
    // Seeded once from the draft. After this the controllers ARE the value and the draft
    // is kept in step through onChanged; re-seeding on rebuild would fight the keyboard.
    _score = TextEditingController(text: widget.draft.score ?? '');
    _observation = TextEditingController(text: widget.draft.observation);
    _conclusion = TextEditingController(text: widget.draft.conclusion);
    _recommendation = TextEditingController(text: widget.draft.recommendation);
    // A card that already says something opens, so a rehydrated report shows its findings
    // rather than a column of closed rows.
    _expanded = widget.draft.hasData;
    // Attached here, not only in didUpdateWidget: without this the first card on screen
    // reported nothing upward until some other card forced a rebuild, so a single-object
    // conclusion saved empty.
    _attach();
  }

  @override
  void dispose() {
    _score.removeListener(_emit);
    _observation.removeListener(_emit);
    _conclusion.removeListener(_emit);
    _recommendation.removeListener(_emit);
    _score.dispose();
    _observation.dispose();
    _conclusion.dispose();
    _recommendation.dispose();
    super.dispose();
  }

  void _emit() {
    widget.onChanged(
      _score.text,
      _observation.text,
      _conclusion.text,
      _recommendation.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final EquipmentDraft draft = widget.draft;
    final RiskLevel? current = RiskLevel.fromWire(draft.currentRiskWire);

    return WorkCard(
      // The tone marks a card the server refused, so a validation summary at the top has
      // something to point at.
      accent: widget.error != null ? EmployeeTokens.red : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        draft.label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.cardTitle,
                      ),
                      const SizedBox(height: 3),
                      Text(
                        <String>[
                          if ((draft.typeName ?? '').isNotEmpty) draft.typeName!,
                          if ((draft.floorName ?? '').isNotEmpty) draft.floorName!,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.rowSub,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                _OriginPill(draft: draft),
                Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 20,
                  color: EmployeeTokens.muted,
                ),
              ],
            ),
          ),

          // The equipment's CURRENT standing — the server's own band, not a preview of the
          // score being typed. See the note in work_report_model.dart for why the app
          // never derives a band locally.
          if (current != null) ...<Widget>[
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                // The band's own Tone triad, so the swatch and glyph stay consistent
                // with every other risk chip in the app.
                EmployeePill(
                  label: current.shortLabel,
                  tone: current.tone,
                  showGlyph: true,
                  glyphLevel: current,
                ),
                const SizedBox(width: 8),
                Text(
                  draft.currentScore == null
                      ? 'Одоогийн үнэлгээ'
                      : 'Одоогийн үнэлгээ ${draft.currentScore}',
                  style: EmployeeTokens.rowSub,
                ),
              ],
            ),
          ],

          if (widget.error != null) ...<Widget>[
            const SizedBox(height: 10),
            NoticeBanner(
              margin: EdgeInsets.zero,
              tone: EmployeeTokens.red,
              icon: Icons.error_outline,
              text: widget.error!,
            ),
          ],

          if (draft.isReadOnly) ...<Widget>[
            const SizedBox(height: 10),
            const NoticeBanner(
              margin: EdgeInsets.zero,
              tone: EmployeeTokens.muted,
              icon: Icons.visibility_outlined,
              title: 'Тоноглол олдохгүй байна',
              // Kept rather than dropped: the finding is real and still on the server, and
              // silently hiding it would lose a record the technician cannot recover.
              text: 'Энэ тоноглол бүртгэлээс хасагдсан эсвэл хандах эрхгүй болсон байна. '
                  'Өмнө бичсэн үнэлгээ хэвээр хадгалагдана.',
            ),
          ],

          if (_expanded) ...<Widget>[
            const SizedBox(height: 12),
            const FieldLabel('Оноо (0-100)'),
            SheetField(
              controller: _score,
              hint: '0-100',
              keyboardType: const TextInputType.numberWithOptions(),
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(3),
              ],
              enabled: widget.editable,
            ),
            const SizedBox(height: 4),
            // The scale in words, exactly as the object assessment sheet states it. The
            // band itself is the server's to decide.
            const Text(
              '81-100 хэвийн · 61-80 анхаарах · 41-60 засварлах · 21-40 ноцтой · '
              '0-20 ашиглах боломжгүй',
              style: EmployeeTokens.rowSub,
            ),

            const SizedBox(height: 10),
            const FieldLabel('Ажиглалт'),
            SheetField(
              controller: _observation,
              hint: 'Юу харагдсан',
              maxLines: 2,
              enabled: widget.editable,
            ),

            const SizedBox(height: 10),
            const FieldLabel('Дүгнэлт'),
            SheetField(
              controller: _conclusion,
              hint: 'Энэ тоноглолын талаарх дүгнэлт',
              maxLines: 2,
              enabled: widget.editable,
            ),

            const SizedBox(height: 10),
            const FieldLabel('Зөвлөмж'),
            SheetField(
              controller: _recommendation,
              hint: 'Санал болгох арга хэмжээ',
              maxLines: 2,
              enabled: widget.editable,
            ),

            const SizedBox(height: 12),
            _ObjectEvidenceStrip(
              photoIds: draft.photoIds,
              busy: widget.uploading,
              onAdd: widget.onAddPhoto,
              onRemove: widget.onRemovePhoto,
            ),

            if (widget.onRemove != null) ...<Widget>[
              const SizedBox(height: 12),
              // Full width on its own line: WorkButton cannot lay out as a non-flexed Row
              // child, which is the defect this codebase already fixed once.
              WorkButton.secondary(
                label: 'Энэ тоноглолыг хасах',
                onPressed: widget.onRemove,
              ),
            ],
          ],
        ],
      ),
    );
  }

  /// Reports every keystroke upward.
  void _attach() {
    _score.addListener(_emit);
    _observation.addListener(_emit);
    _conclusion.addListener(_emit);
    _recommendation.addListener(_emit);
  }
}

/// Whether this card carries a saved finding, a bare selection, or a lost object.
class _OriginPill extends StatelessWidget {
  const _OriginPill({required this.draft});

  final EquipmentDraft draft;

  @override
  Widget build(BuildContext context) {
    final String label = switch (draft.origin) {
      EquipmentOrigin.unavailable => 'Олдохгүй',
      EquipmentOrigin.assessed => 'Үнэлсэн',
      EquipmentOrigin.selected => draft.hasData ? 'Бичиж байна' : 'Хоосон',
    };

    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: EmployeePill.outline(label: label),
    );
  }
}

/// Evidence for ONE piece of equipment.
///
/// Separate from the visit-level before/after strip: a photo of one panel is not evidence
/// about another, and the server stores these on the item rather than on the report.
///
/// The DTO returns ids only, so the bytes are fetched through the authenticated client by
/// id. No raw or public URL is ever built or shown.
class _ObjectEvidenceStrip extends ConsumerWidget {
  const _ObjectEvidenceStrip({
    required this.photoIds,
    required this.busy,
    this.onAdd,
    this.onRemove,
  });

  final List<String> photoIds;
  final bool busy;
  final VoidCallback? onAdd;
  final ValueChanged<String>? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (photoIds.isEmpty && onAdd == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        FieldLabel('Нотлох зураг (${photoIds.length})'),
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
