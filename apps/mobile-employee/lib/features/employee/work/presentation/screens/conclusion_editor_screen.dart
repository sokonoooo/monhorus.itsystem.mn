import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/media/photo_capture.dart';
import '../../../project/data/models/object_models.dart';
import '../../../project/data/models/project_models.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/photo_source_sheet.dart';
import '../../data/models/work_report_model.dart';
import '../providers/conclusion_providers.dart';
import '../widgets/equipment_assessment_card.dart';
import '../widgets/report_photo_strip.dart';
import '../widgets/work_async_view.dart';
import '../widgets/work_ui.dart';

/// Дүгнэлт бичих — the service-request conclusion, device by device.
///
/// A full screen rather than a sheet. The editor holds a floor picker, an equipment picker
/// and one expandable card per assessed object, each with four text fields and its own
/// evidence strip; a bottom sheet at that size is a scroll trap on a phone, and the flow is
/// long enough that losing it to an accidental drag-dismiss is a real cost.
///
/// The screen is only ever reached from an explicit tap. `GET /service-requests/:id/report`
/// CREATES the draft and attributes it to the caller, so opening it speculatively — from a
/// list, or to decide whether to show a button — would make every passing technician the
/// author of an empty conclusion.
class ConclusionEditorScreen extends ConsumerStatefulWidget {
  const ConclusionEditorScreen({
    super.key,
    required this.requestId,
    required this.requestNumber,
    this.buildingId,
    this.buildingName,
  });

  final String requestId;
  final String requestNumber;

  /// Where the call was. Null leaves the equipment picker unusable, and the screen says so
  /// rather than drawing a control that can never resolve a floor.
  final String? buildingId;
  final String? buildingName;

  static Route<void> route({
    required String requestId,
    required String requestNumber,
    String? buildingId,
    String? buildingName,
  }) {
    return MaterialPageRoute<void>(
      builder: (_) => ConclusionEditorScreen(
        requestId: requestId,
        requestNumber: requestNumber,
        buildingId: buildingId,
        buildingName: buildingName,
      ),
    );
  }

  @override
  ConsumerState<ConclusionEditorScreen> createState() => _ConclusionEditorScreenState();
}

class _ConclusionEditorScreenState extends ConsumerState<ConclusionEditorScreen> {
  final TextEditingController _score = TextEditingController();
  final TextEditingController _conclusion = TextEditingController();
  final TextEditingController _recommendation = TextEditingController();
  String? _floorId;
  bool _hydrated = false;

  ConclusionRef get _ref => (requestId: widget.requestId, buildingId: widget.buildingId);

  @override
  void dispose() {
    _score.dispose();
    _conclusion.dispose();
    _recommendation.dispose();
    super.dispose();
  }

  /// Fills the overall fields once, from the loaded report.
  ///
  /// Guarded so a later rebuild cannot overwrite what is being typed: the controllers are
  /// the live value from then on, and the notifier is told about each change.
  void _hydrateOnce(ConclusionEditorState state) {
    if (_hydrated) return;
    _hydrated = true;
    _score.text = state.score;
    _conclusion.text = state.conclusion;
    _recommendation.text = state.recommendation;
  }

  Future<void> _addFromFloor() async {
    final String? floorId = _floorId;
    if (floorId == null) return;

    final List<ObjectListItemModel>? chosen =
        await showModalBottomSheet<List<ObjectListItemModel>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EquipmentPickerSheet(floorId: floorId),
    );

    if (chosen == null || chosen.isEmpty) return;
    ref.read(conclusionEditorProvider(_ref).notifier).addEquipment(chosen);
  }

  /// Warns before a removal that would discard typed values.
  Future<void> _confirmRemove(EquipmentDraft draft) async {
    if (draft.hasData) {
      final bool discard = await _confirm(
        title: 'Бичсэн үнэлгээ устна',
        body: '"${draft.label}" тоноглолд оноо, ажиглалт эсвэл дүгнэлт бичсэн байна. '
            'Хасвал эдгээр нь устана. Үргэлжлүүлэх үү?',
        confirmLabel: 'Тийм, хасах',
      );
      if (!discard) return;
    }
    ref.read(conclusionEditorProvider(_ref).notifier).removeEquipment(draft.objectId);
  }

  /// Switches which floor the picker offers.
  ///
  /// NOTHING IS DISCARDED, which is why there is no confirmation here. The floor selector
  /// chooses what the ADD sheet lists; already-selected equipment stays selected and keeps
  /// its typed values, because a single visit routinely covers two floors and dropping a
  /// half-written finding on switching would be the data loss the warning was meant to
  /// prevent. Removal is explicit, per card, and that is where the warning lives.
  void _changeFloor(String? next) {
    setState(() => _floorId = next);
  }

  Future<bool> _confirm({
    required String title,
    required String body,
    required String confirmLabel,
  }) async {
    final bool? answer = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title, style: EmployeeTokens.cardTitle),
        content: Text(body, style: EmployeeTokens.rowSub),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Болих'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return answer ?? false;
  }

  Future<void> _save({required bool andSubmit}) async {
    final ConclusionEditor notifier = ref.read(conclusionEditorProvider(_ref).notifier);
    notifier.setScore(_score.text);
    notifier.setConclusion(_conclusion.text);
    notifier.setRecommendation(_recommendation.text);

    final String? failure = andSubmit ? await notifier.submit() : await notifier.save();
    if (!mounted) return;

    _toast(
      failure ?? (andSubmit ? 'Хянуулахаар илгээлээ.' : 'Дүгнэлт хадгалагдлаа.'),
      failed: failure != null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ConclusionGrants grants = ref.watch(conclusionGrantsProvider);
    final AsyncValue<ConclusionEditorState> editor =
        ref.watch(conclusionEditorProvider(_ref));

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      appBar: AppBar(
        title: Text('${widget.requestNumber} · Дүгнэлт'),
        backgroundColor: EmployeeTokens.white,
      ),
      body: SafeArea(
        child: WorkAsyncView<ConclusionEditorState>(
          value: editor,
          onRetry: () => ref.invalidate(conclusionEditorProvider(_ref)),
          builder: (BuildContext context, ConclusionEditorState state) {
            _hydrateOnce(state);
            final bool writable = state.isEditable && grants.canAuthor;

            return ListView(
              padding: const EdgeInsets.fromLTRB(
                EmployeeTokens.gutter,
                12,
                EmployeeTokens.gutter,
                EmployeeTokens.scrollBottomSpacer,
              ),
              children: <Widget>[
                _StatusStrip(state: state, canAuthor: grants.canAuthor),

                if (writable && state.missing.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 12),
                  _MissingBanner(missing: state.missing),
                ],

                if (state.hasNoEquipment) ...<Widget>[
                  const SizedBox(height: 12),
                  const NoticeBanner(
                    margin: EdgeInsets.zero,
                    tone: EmployeeTokens.yellow,
                    icon: Icons.info_outline,
                    title: 'Тоноглол сонгоогүй байна',
                    // The exclusion rule, said where it can still be acted on.
                    text: 'Төхөөрөмж сонгож үнэлгээ бичээгүй тул энэ дүгнэлт '
                        '"Үзлэг ба дүгнэлт" хэсэгт харагдахгүй.',
                  ),
                ],

                // THE FOUR VISIT-LEVEL REQUIREMENTS, EACH WITH ITS OWN CONTROL.
                //
                // `workReportCompleteness` checks the visit's score, conclusion,
                // recommendation and its two photographs, and none of them is satisfied by
                // a filled-in equipment card. Three of the four had no control on this
                // screen at all, so a technician who had written up every device was
                // refused over fields the app never showed and could not send. They are
                // drawn together, above the equipment, and each says it is mandatory.
                const SizedBox(height: 14),
                _RequiredLabel(
                  'Ерөнхий үнэлгээ (0-100)',
                  missing: state.isMissing(WorkReportRequirement.score),
                ),
                SheetField(
                  controller: _score,
                  hint: '0-100',
                  keyboardType: const TextInputType.numberWithOptions(),
                  inputFormatters: <TextInputFormatter>[
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(3),
                  ],
                  enabled: writable,
                ),
                const SizedBox(height: 4),
                // The scale in words, as every other score field in this app states it. The
                // band itself is the server's to derive.
                Text(
                  'Айлчлалын нэгдсэн үнэлгээ. Тоноглол бүрийн оноо үүнийг орлохгүй.',
                  style: EmployeeTokens.rowSub,
                ),

                const SizedBox(height: 10),
                _RequiredLabel(
                  'Ерөнхий дүгнэлт',
                  missing: state.isMissing(WorkReportRequirement.conclusion),
                ),
                SheetField(
                  controller: _conclusion,
                  hint: 'Ажлын явц, илэрсэн зүйл',
                  maxLines: 4,
                  enabled: writable,
                ),
                const SizedBox(height: 10),
                _RequiredLabel(
                  'Зөвлөмж',
                  missing: state.isMissing(WorkReportRequirement.recommendation),
                ),
                SheetField(
                  controller: _recommendation,
                  hint: 'Дараагийн алхам',
                  maxLines: 3,
                  enabled: writable,
                ),

                const SizedBox(height: 14),
                ReportPhotoStrip(
                  label: VisitPhotoSlot.before.label,
                  photoIds: state.beforePhotoIds,
                  required: true,
                  busy: state.uploadingFor == VisitPhotoSlot.before.uploadKey,
                  onAdd: writable ? () => _captureVisit(VisitPhotoSlot.before) : null,
                  onRemove: writable
                      ? (String photoId) => ref
                          .read(conclusionEditorProvider(_ref).notifier)
                          .removeVisitPhoto(VisitPhotoSlot.before, photoId)
                      : null,
                ),
                const SizedBox(height: 12),
                ReportPhotoStrip(
                  label: VisitPhotoSlot.after.label,
                  photoIds: state.afterPhotoIds,
                  required: true,
                  busy: state.uploadingFor == VisitPhotoSlot.after.uploadKey,
                  onAdd: writable ? () => _captureVisit(VisitPhotoSlot.after) : null,
                  onRemove: writable
                      ? (String photoId) => ref
                          .read(conclusionEditorProvider(_ref).notifier)
                          .removeVisitPhoto(VisitPhotoSlot.after, photoId)
                      : null,
                ),

                const SizedBox(height: 16),
                const FieldLabel('Байршил'),
                _LocationRow(
                  buildingName: widget.buildingName,
                  buildingId: widget.buildingId,
                  floorId: _floorId,
                  enabled: writable,
                  onFloorChanged: _changeFloor,
                  onAdd: _floorId == null ? null : _addFromFloor,
                ),

                const SizedBox(height: 16),
                FieldLabel('Үнэлгээ хийсэн тоноглол (${state.drafts.length})'),
                if (state.drafts.isEmpty)
                  Text(
                    'Давхар сонгоод тоноглол нэмнэ үү.',
                    style: EmployeeTokens.rowSub,
                  )
                else
                  for (final EquipmentDraft draft in state.drafts)
                    EquipmentAssessmentCard(
                      key: ValueKey<String>(draft.objectId),
                      draft: draft,
                      editable: writable && !draft.isReadOnly,
                      uploading: state.uploadingFor == draft.objectId,
                      error: state.itemErrors[draft.objectId],
                      onChanged: (
                        String? score,
                        String? observation,
                        String? conclusion,
                        String? recommendation,
                      ) =>
                          ref.read(conclusionEditorProvider(_ref).notifier).patchDraft(
                                draft.objectId,
                                score: score,
                                observation: observation,
                                conclusion: conclusion,
                                recommendation: recommendation,
                              ),
                      onRemove: writable && !draft.isReadOnly
                          ? () => _confirmRemove(draft)
                          : null,
                      onAddPhoto: writable && !draft.isReadOnly
                          ? () => _capture(draft.objectId)
                          : null,
                      onRemovePhoto: writable && !draft.isReadOnly
                          ? (String photoId) => ref
                              .read(conclusionEditorProvider(_ref).notifier)
                              .removePhoto(draft.objectId, photoId)
                          : null,
                    ),

                if (writable) ...<Widget>[
                  const SizedBox(height: 18),
                  // Each on its own line: WorkButton is a full-width pill, and a Row gives
                  // a non-flexed child unbounded width, which it cannot lay out in.
                  WorkButton.secondary(
                    label: 'Ноорогт хадгалах',
                    busy: state.saving,
                    onPressed: state.saving ? null : () => _save(andSubmit: false),
                  ),
                  const SizedBox(height: 10),
                  WorkButton(
                    label: 'Хянуулахаар илгээх',
                    busy: state.saving,
                    onPressed: state.saving ? null : () => _save(andSubmit: true),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  /// Camera or gallery, then upload. Cancel is a cancel, not a failure.
  Future<void> _capture(String objectId) async {
    final PhotoSource? source = await showPhotoSourceSheet(context);
    if (source == null || !mounted) return;

    final PhotoCaptureResult picked = await capturePhoto(source: source);
    if (!mounted) return;

    switch (picked) {
      case PhotoCaptureCancelled():
        return;
      case PhotoCaptureFailed(message: final String message):
        _toast(message, failed: true);
      case PhotoCaptured(photo: final CapturedPhoto photo):
        final String? failure = await ref
            .read(conclusionEditorProvider(_ref).notifier)
            .attachPhoto(objectId, photo);
        if (failure != null && mounted) _toast(failure, failed: true);
    }
  }

  /// The same capture flow, landing on the visit rather than on a device.
  Future<void> _captureVisit(VisitPhotoSlot slot) async {
    final PhotoSource? source = await showPhotoSourceSheet(context);
    if (source == null || !mounted) return;

    final PhotoCaptureResult picked = await capturePhoto(source: source);
    if (!mounted) return;

    switch (picked) {
      case PhotoCaptureCancelled():
        return;
      case PhotoCaptureFailed(message: final String message):
        _toast(message, failed: true);
      case PhotoCaptured(photo: final CapturedPhoto photo):
        final String? failure = await ref
            .read(conclusionEditorProvider(_ref).notifier)
            .attachVisitPhoto(slot, photo);
        if (failure != null && mounted) _toast(failure, failed: true);
    }
  }

  void _toast(String message, {bool failed = false}) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: failed ? EmployeeTokens.red : EmployeeTokens.ink,
        ),
      );
  }
}

/// What the server says is still missing, named field by field.
///
/// The list comes from `workReportCompleteness` and arrives on every read, every save and
/// every refused submission. It used to be parsed and thrown away: the technician saw only
/// "Дүгнэлт дутуу тул илгээх боломжгүй." — a message that repeats the problem instead of
/// naming it — while the server had already said exactly which fields were empty.
class _MissingBanner extends StatelessWidget {
  const _MissingBanner({required this.missing});

  final List<WorkReportRequirement> missing;

  @override
  Widget build(BuildContext context) {
    return NoticeBanner(
      margin: EdgeInsets.zero,
      tone: EmployeeTokens.yellow,
      icon: Icons.checklist,
      title: 'Илгээхэд дутуу байна (${missing.length})',
      text: missing
          .map((WorkReportRequirement requirement) => '• ${requirement.label}')
          .join('\n'),
    );
  }
}

/// A field label that says the field is mandatory, and shows when it is the thing blocking
/// submission.
class _RequiredLabel extends StatelessWidget {
  const _RequiredLabel(this.text, {required this.missing});

  final String text;
  final bool missing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(child: FieldLabel(text)),
        Text(
          'Заавал',
          style: EmployeeTokens.rowSub.copyWith(
            color: missing ? EmployeeTokens.red : EmployeeTokens.muted,
          ),
        ),
      ],
    );
  }
}

/// The report's status, and why the editor may be read-only.
class _StatusStrip extends StatelessWidget {
  const _StatusStrip({required this.state, required this.canAuthor});

  final ConclusionEditorState state;
  final bool canAuthor;

  @override
  Widget build(BuildContext context) {
    if (!canAuthor) {
      return const NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.lock_outline,
        title: 'Зөвхөн харах эрхтэй',
        text: 'Танд "service_request.update" эрх байхгүй тул дүгнэлт бичих боломжгүй. '
            'Бичигдсэн дүгнэлтийг харах боломжтой.',
      );
    }

    if (!state.isEditable) {
      return NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.lock_outline,
        title: 'Дүгнэлт "${state.report.status.label}" төлөвт байна',
        text: 'Илгээсэн буюу батлагдсан дүгнэлтийг өөрчлөх боломжгүй. Засах шаардлагатай '
            'бол хянагчаар буцаалгана уу.',
      );
    }

    if (state.report.status == WorkReportStatus.returned && state.report.returnReason != null) {
      return NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.yellow,
        icon: Icons.undo,
        title: 'Засварлуулахаар буцаасан',
        text: state.report.returnReason!,
      );
    }

    return const SizedBox.shrink();
  }
}

/// Building (fixed) and floor (chosen), with the add action underneath.
class _LocationRow extends ConsumerWidget {
  const _LocationRow({
    required this.buildingName,
    required this.buildingId,
    required this.floorId,
    required this.enabled,
    required this.onFloorChanged,
    required this.onAdd,
  });

  final String? buildingName;
  final String? buildingId;
  final String? floorId;
  final bool enabled;
  final ValueChanged<String?> onFloorChanged;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (buildingId == null) {
      return const NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.info_outline,
        text: 'Энэ хүсэлт барилга заагаагүй тул тоноглол сонгох боломжгүй.',
      );
    }

    final AsyncValue<List<FloorModel>> floors =
        ref.watch(conclusionFloorsProvider(buildingId!));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        InfoRow(label: 'Барилга', value: buildingName ?? '-'),
        const SizedBox(height: 8),
        floors.when(
          loading: () => Text('Давхар ачааллаж байна…', style: EmployeeTokens.rowSub),
          error: (Object _, StackTrace __) => Text(
            'Давхрын жагсаалт ачаалж чадсангүй.',
            style: EmployeeTokens.rowSub,
          ),
          data: (List<FloorModel> items) => items.isEmpty
              ? Text('Энэ барилгад давхар бүртгэгдээгүй байна.',
                  style: EmployeeTokens.rowSub)
              : DropdownButtonFormField<String>(
                  initialValue: floorId,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    hintText: 'Давхар сонгоно уу',
                    isDense: true,
                  ),
                  items: items
                      .map(
                        (FloorModel floor) => DropdownMenuItem<String>(
                          value: floor.id,
                          child: Text(floor.name, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: enabled ? onFloorChanged : null,
                ),
        ),
        if (enabled) ...<Widget>[
          const SizedBox(height: 10),
          WorkButton.secondary(
            label: 'Тоноглол нэмэх',
            onPressed: onAdd,
          ),
        ],
      ],
    );
  }
}

/// Multi-select over one floor's equipment.
class _EquipmentPickerSheet extends ConsumerStatefulWidget {
  const _EquipmentPickerSheet({required this.floorId});

  final String floorId;

  @override
  ConsumerState<_EquipmentPickerSheet> createState() => _EquipmentPickerSheetState();
}

class _EquipmentPickerSheetState extends ConsumerState<_EquipmentPickerSheet> {
  final Set<String> _picked = <String>{};

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<ObjectListItemModel>> equipment =
        ref.watch(conclusionEquipmentProvider(widget.floorId));

    return Container(
      decoration: const BoxDecoration(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.85,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const SheetHandle(),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: FieldLabel('Тоноглол сонгох'),
          ),
          Flexible(
            child: equipment.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (Object _, StackTrace __) => Padding(
                padding: const EdgeInsets.all(24),
                child: Text('Тоноглол ачаалж чадсангүй.', style: EmployeeTokens.rowSub),
              ),
              data: (List<ObjectListItemModel> items) => items.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'Энэ давхарт ашиглалтад байгаа тоноглол бүртгэгдээгүй байна.',
                        style: EmployeeTokens.rowSub,
                      ),
                    )
                  : ListView(
                      shrinkWrap: true,
                      children: <Widget>[
                        for (final ObjectListItemModel object in items)
                          CheckboxListTile(
                            value: _picked.contains(object.id),
                            onChanged: (bool? on) => setState(() {
                              if (on == true) {
                                _picked.add(object.id);
                              } else {
                                _picked.remove(object.id);
                              }
                            }),
                            title: Text(
                              object.code.isEmpty
                                  ? object.name
                                  : '${object.code} · ${object.name}',
                              style: EmployeeTokens.rowTitle,
                            ),
                            subtitle: Text(
                              <String>[
                                if (object.objectType?.name != null) object.objectType!.name,
                                if (object.status != null) object.status!.label,
                              ].join(' · '),
                              style: EmployeeTokens.rowSub,
                            ),
                          ),
                      ],
                    ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: WorkButton(
              label: 'Сонгосныг нэмэх (${_picked.length})',
              onPressed: _picked.isEmpty
                  ? null
                  : () {
                      final List<ObjectListItemModel> chosen =
                          (equipment.value ?? const <ObjectListItemModel>[])
                              .where((ObjectListItemModel object) =>
                                  _picked.contains(object.id))
                              .toList();
                      Navigator.of(context).pop(chosen);
                    },
            ),
          ),
        ],
      ),
    );
  }
}
