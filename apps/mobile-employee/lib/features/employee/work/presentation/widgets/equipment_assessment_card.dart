import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../project/domain/entities/risk_level.dart';
import '../providers/conclusion_providers.dart';
import 'report_photo_strip.dart';
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
            Text(
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
            // Evidence for ONE piece of equipment. Separate from the visit-level
            // before/after strips: a photo of one panel is not evidence about another, and
            // the server stores these on the item rather than on the report — which is
            // also why filling these in does not satisfy BEFORE_PHOTO or AFTER_PHOTO.
            ReportPhotoStrip(
              label: 'Нотлох зураг',
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
