import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../domain/entities/object_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../../../presentation/widgets/employee_ui.dart';
import '../../../presentation/widgets/photo_source_sheet.dart';
import '../../data/models/object_models.dart';
import '../providers/project_providers.dart';

/// "Дүгнэлт тайлан бичих" — the device үнэлгээ, written from the handset.
///
/// Two facts govern this sheet:
///
/// 1. **Evidence first.** `createObjectAssessmentSchema` refuses an empty
///    `photoIds`, so the picture is uploaded before the assessment exists and its id
///    is carried into the body. Until the assessment is submitted the file is parked
///    on the uploader and belongs to nothing, which is why the save button stays
///    disabled until at least one photo has landed: the sheet never lets a technician
///    fill in a form that the server is certain to refuse.
///
/// 2. **The band is the server's to decide.** Score thresholds are configurable in
///    settings, and the conditional requirements on Дүгнэлт, Зөвлөмж and Авах арга
///    хэмжээ hang off the resolved band. Nothing here guesses at them. The note under
///    the score states the rule in words, and a refusal is printed against the exact
///    field the backend named.
///
/// An assessment is append-only — there is no PATCH and no DELETE for one in the API
/// — so the footer says so before it is sent.
Future<void> showAssessmentSheet(
  BuildContext context, {
  required String objectId,
  required String deviceLabel,
  int? currentScore,
}) {
  // Nothing is returned to the caller: `DeviceAssessmentController.submit` already
  // invalidates the device, its history and the floor list it is sorted into, so the
  // screen behind the sheet has refreshed itself by the time it reappears.
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    // A half-filled assessment with an uploaded photo behind it is worth a
    // deliberate dismissal rather than a stray tap on the scrim.
    isDismissible: false,
    enableDrag: false,
    builder: (BuildContext sheetContext) => _AssessmentSheet(
      objectId: objectId,
      deviceLabel: deviceLabel,
      currentScore: currentScore,
    ),
  );
}

class _AssessmentSheet extends ConsumerStatefulWidget {
  const _AssessmentSheet({
    required this.objectId,
    required this.deviceLabel,
    required this.currentScore,
  });

  final String objectId;
  final String deviceLabel;
  final int? currentScore;

  @override
  ConsumerState<_AssessmentSheet> createState() => _AssessmentSheetState();
}

class _AssessmentSheetState extends ConsumerState<_AssessmentSheet> {
  late final TextEditingController _score;
  late final TextEditingController _conclusion;
  late final TextEditingController _recommendation;
  late final TextEditingController _actionTaken;
  late final TextEditingController _measuredLoad;

  /// The repeatable load readings, in the order they were added.
  ///
  /// Each row owns a controller, so adding and removing rows is adding and removing
  /// controllers — hence the explicit dispose on removal as well as on teardown.
  final List<_MeasurementRow> _measurements = <_MeasurementRow>[];

  /// Files that are already on the server, in upload order.
  final List<ObjectPhotoModel> _photos = <ObjectPhotoModel>[];

  /// The bytes of each, kept so the thumbnails render without a round trip back
  /// through `GET /files/:fileId` for a picture this device just took.
  final Map<String, Uint8List> _thumbnails = <String, Uint8List>{};

  bool _repairRequired = false;
  bool _uploading = false;
  bool _saving = false;

  String? _photoError;
  String? _submitError;
  Map<String, String> _fieldErrors = const <String, String>{};

  @override
  void initState() {
    super.initState();
    // Deliberately not pre-filled with the previous score: an assessment is a fresh
    // reading, and a pre-filled number is the one a tired thumb confirms.
    _score = TextEditingController();
    _conclusion = TextEditingController();
    _recommendation = TextEditingController();
    _actionTaken = TextEditingController();
    _measuredLoad = TextEditingController();
  }

  @override
  void dispose() {
    _score.dispose();
    _conclusion.dispose();
    _recommendation.dispose();
    _actionTaken.dispose();
    _measuredLoad.dispose();
    for (final _MeasurementRow row in _measurements) {
      row.value.dispose();
    }
    super.dispose();
  }

  /// `MAX_LOAD_MEASUREMENTS` in packages/shared/src/constants/load-measurement.ts.
  static const int _maxMeasurements = 12;

  /// Adds a row that does not collide with one already on the form.
  ///
  /// The backend refuses two readings of the same kind on the same phase, so a blind
  /// default would hand the technician a refusal for a button press. Phase-less first
  /// (the single-phase case), then L1, L2, L3, N — which is what filling in a
  /// three-phase panel actually looks like.
  void _addMeasurement() {
    final Set<String?> taken = _measurements
        .where((_MeasurementRow row) => row.kind == LoadMeasurementKind.current)
        .map((_MeasurementRow row) => row.phase?.wireValue)
        .toSet();

    final LoadMeasurementPhase? free = <LoadMeasurementPhase?>[
      null,
      ...LoadMeasurementPhase.values,
    ].firstWhere(
      (LoadMeasurementPhase? phase) => !taken.contains(phase?.wireValue),
      orElse: () => null,
    );

    setState(() {
      _measurements.add(
        _MeasurementRow(kind: LoadMeasurementKind.current, phase: free),
      );
    });
  }

  void _removeMeasurement(int index) {
    setState(() {
      _measurements.removeAt(index).value.dispose();
    });
  }

  bool get _busy => _uploading || _saving;

  /// `createObjectAssessmentSchema` caps `photoIds` at 20. Enforced here so the
  /// twenty-first picture is never uploaded — it would be stored, orphaned, and then
  /// rejected with the rest of the form.
  static const int _maxPhotos = 20;

  bool get _canAddPhoto => !_busy && _photos.length < _maxPhotos;

  Future<void> _addPhoto() async {
    if (!_canAddPhoto) return;

    final PhotoSource? source = await showPhotoSourceSheet(context);
    if (source == null || !mounted) return;

    final PhotoCaptureResult picked = await capturePhoto(source: source);
    if (!mounted) return;

    switch (picked) {
      case PhotoCaptureCancelled():
        // Backing out of the camera is the normal case, not a problem to report.
        return;
      case PhotoCaptureFailed(message: final String message):
        setState(() => _photoError = message);
        return;
      case PhotoCaptured(photo: final CapturedPhoto photo):
        setState(() {
          _uploading = true;
          _photoError = null;
        });

        final ApiResult<ObjectPhotoModel> result = await ref
            .read(deviceAssessmentProvider(widget.objectId))
            .uploadPhoto(photo);

        if (!mounted) return;

        result.when(
          success: (ObjectPhotoModel stored) {
            setState(() {
              _uploading = false;
              _photos.add(stored);
              _thumbnails[stored.id] = photo.bytes;
              // A refusal that was about the missing evidence is now stale.
              _fieldErrors = Map<String, String>.from(_fieldErrors)
                ..remove('photoIds');
            });
          },
          failure: (Failure failure) => setState(() {
            _uploading = false;
            _photoError = failure.message;
          }),
        );
    }
  }

  Future<void> _submit() async {
    if (_busy) return;

    final String rawScore = _score.text.trim();
    final int? score = int.tryParse(rawScore);

    final Map<String, String> issues = <String, String>{};
    if (score == null || score < 0 || score > 100) {
      issues['newScore'] = 'Оноо 0-100 хооронд бүхэл тоо байна.';
    }

    final String rawLoad = _measuredLoad.text.trim().replaceAll(',', '.');
    double? measuredLoadKw;
    if (rawLoad.isNotEmpty) {
      measuredLoadKw = double.tryParse(rawLoad);
      if (measuredLoadKw == null || measuredLoadKw < 0) {
        issues['measuredLoadKw'] = 'Хэмжсэн ачаалал эерэг тоо байна.';
      }
    }

    // Each reading is parsed and reported against its own row, so a bad number names
    // the line it is on rather than failing the form as a whole.
    final List<LoadMeasurementModel> measurements = <LoadMeasurementModel>[];
    for (int index = 0; index < _measurements.length; index++) {
      final _MeasurementRow row = _measurements[index];
      final String raw = row.value.text.trim().replaceAll(',', '.');
      final double? parsed = raw.isEmpty ? null : double.tryParse(raw);
      if (parsed == null || parsed < 0) {
        issues['measurements.$index.value'] = 'Хэмжсэн утга эерэг тоо байна.';
        continue;
      }
      measurements.add(
        LoadMeasurementModel(
          kind: row.kind,
          value: parsed,
          // The unit is never chosen by hand: there is exactly one per kind, and
          // `toJson` fills it in from the kind so the pair cannot be sent disagreeing.
          unit: row.kind.unit,
          phase: row.kind.acceptsPhase ? row.phase : null,
        ),
      );
    }

    if (_photos.isEmpty) {
      issues['photoIds'] = 'Дор хаяж нэг нотлох зураг хавсаргана уу.';
    }

    if (issues.isNotEmpty) {
      setState(() {
        _fieldErrors = issues;
        _submitError = null;
      });
      return;
    }

    setState(() {
      _saving = true;
      _fieldErrors = const <String, String>{};
      _submitError = null;
    });

    final ApiResult<ObjectAssessmentModel> result =
        await ref.read(deviceAssessmentProvider(widget.objectId)).submit(
              CreateAssessmentRequest(
                newScore: score!,
                photoIds: _photos
                    .map((ObjectPhotoModel photo) => photo.id)
                    .toList(growable: false),
                conclusion: _conclusion.text.trim(),
                recommendation: _recommendation.text.trim(),
                actionTaken: _actionTaken.text.trim(),
                measuredLoadKw: measuredLoadKw,
                measurements: measurements,
                repairRequired: _repairRequired,
              ),
            );

    if (!mounted) return;

    result.when(
      success: (ObjectAssessmentModel assessment) {
        Navigator.of(context).pop();
        showEmployeeToast(
          context,
          message: 'Үнэлгээ бүртгэгдлээ — ${assessment.newScore} оноо'
              '${assessment.riskLevel == null ? '' : ' · ${assessment.riskLevel!.label}'}',
          tone: EmployeeTokens.green,
        );
      },
      failure: (Failure failure) {
        setState(() {
          _saving = false;
          _submitError = failure.message;
          // The band-conditional rules are enforced server-side, so the per-field
          // messages are the only place the technician learns which of Дүгнэлт,
          // Зөвлөмж or Арга хэмжээ this score demands.
          _fieldErrors = failure is ServerFailure
              ? failure.fieldErrors
              : const <String, String>{};
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.92,
        ),
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                color: EmployeeTokens.line,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                children: <Widget>[
                  Text(
                    'Дүгнэлт тайлан бичих',
                    style: EmployeeTokens.screenTitle,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    widget.deviceLabel,
                    style: EmployeeTokens.noticeBody.copyWith(
                      fontWeight: FontWeight.w400,
                      color: EmployeeTokens.muted,
                    ),
                  ),
                  const SizedBox(height: 18),

                  const _Label('Үнэлгээний оноо (0–100)'),
                  _SheetField(
                    controller: _score,
                    hint: widget.currentScore == null
                        ? '0–100'
                        : 'Өмнөх оноо ${widget.currentScore}',
                    keyboardType: TextInputType.number,
                    inputFormatters: <TextInputFormatter>[
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(3),
                    ],
                    error: _fieldErrors['newScore'],
                    enabled: !_busy,
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 5, bottom: 12),
                    // Band names, not colour names. This sentence used to read
                    // "Улаан, хар түвшинд … шар, улбар шарт …", which told a
                    // colour-blind technician nothing about which rule applied to
                    // the score they had just typed. Interpolated from the enum so
                    // the wording cannot drift from the labels on the chips.
                    child: Text(
                      'Эрсдэлийн түвшнийг систем оноогоор тодорхойлно. '
                      '"${RiskLevel.critical.label}", '
                      '"${RiskLevel.outOfService.label}" түвшинд дүгнэлт, зөвлөмж, '
                      'авах арга хэмжээ гурвуулаа заавал; '
                      '"${RiskLevel.attention.label}", '
                      '"${RiskLevel.scheduleRepair.label}" түвшинд зөвлөмж болон '
                      'засварын тэмдэглэгээ заавал.',
                      style: EmployeeTokens.microNote.copyWith(height: 1.5),
                    ),
                  ),

                  const _Label('Нотлох зураг (заавал)'),
                  _PhotoRow(
                    photos: _photos,
                    thumbnails: _thumbnails,
                    busy: _uploading,
                    onAdd: _canAddPhoto ? _addPhoto : null,
                  ),
                  if (_photos.length >= _maxPhotos)
                    Padding(
                      padding: const EdgeInsets.only(top: 5),
                      child: Text(
                        'Нэг үнэлгээнд дээд тал нь 20 зураг хавсаргана.',
                        style: EmployeeTokens.microNote,
                      ),
                    ),
                  if (_fieldErrors['photoIds'] != null)
                    _ErrorLine(_fieldErrors['photoIds']!),
                  if (_photoError != null) ...<Widget>[
                    const SizedBox(height: 10),
                    _ErrorBanner(
                      icon: Icons.image_not_supported_outlined,
                      text: _photoError!,
                    ),
                  ],
                  const SizedBox(height: 16),

                  const _Label('Дүгнэлт'),
                  _SheetField(
                    controller: _conclusion,
                    hint: 'Юу илэрсэн, ямар байдалтай байсныг бичнэ үү...',
                    maxLines: 4,
                    error: _fieldErrors['conclusion'],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 14),

                  const _Label('Зөвлөмж'),
                  _SheetField(
                    controller: _recommendation,
                    hint: 'Эрсдэлийг бууруулах зөвлөмж...',
                    maxLines: 3,
                    error: _fieldErrors['recommendation'],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 14),

                  const _Label('Авсан арга хэмжээ'),
                  _SheetField(
                    controller: _actionTaken,
                    hint: 'Газар дээр нь юу хийснээ бичнэ үү...',
                    maxLines: 3,
                    error: _fieldErrors['actionTaken'],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 14),

                  const _Label('Хэмжсэн ачаалал (kW)'),
                  _SheetField(
                    controller: _measuredLoad,
                    hint: 'Жишээ нь 12.4',
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    error: _fieldErrors['measuredLoadKw'],
                    enabled: !_busy,
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 5, bottom: 12),
                    child: Text(
                      'Хэмжсэн утга тооцоолсон ачаалалтай нийлдэггүй — тусад нь '
                      'хадгалагдана.',
                      style: EmployeeTokens.microNote.copyWith(height: 1.5),
                    ),
                  ),

                  // Amps and volts sit beside the kW box, never inside it: only the kW
                  // figure is summed into a floor total, so a 42 A reading typed into
                  // that box would become 42 kW of load that was never there.
                  _MeasurementEditor(
                    rows: _measurements,
                    fieldErrors: _fieldErrors,
                    enabled: !_busy,
                    onAdd: _measurements.length < _maxMeasurements
                        ? _addMeasurement
                        : null,
                    onRemove: _removeMeasurement,
                    onChanged: () => setState(() {}),
                  ),
                  const SizedBox(height: 14),

                  _RepairToggle(
                    value: _repairRequired,
                    onChanged: _busy
                        ? null
                        : (bool value) => setState(() => _repairRequired = value),
                    error: _fieldErrors['revisitRequired'],
                  ),

                  if (_submitError != null) ...<Widget>[
                    const SizedBox(height: 12),
                    _ErrorBanner(
                      icon: Icons.error_outline,
                      text: _submitError!,
                    ),
                  ],

                  const SizedBox(height: 12),
                  const Text(
                    'Бүртгэсэн үнэлгээг дараа нь засах, устгах боломжгүй. Алдаа '
                    'гарвал шинэ үнэлгээ бүртгэнэ.',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: EmployeeTokens.muted,
                      height: 1.5,
                    ),
                  ),
                  const Text(
                    'Дахин үзлэгийн огноо, хариуцагчийг вэб системээр бүртгэнэ.',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: EmployeeTokens.muted,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
            _Footer(
              busy: _saving,
              canSave: _photos.isNotEmpty && !_busy,
              onCancel: _busy ? null : () => Navigator.of(context).pop(),
              onSave: _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/// One row of the load reading editor while it is being filled in.
///
/// Mutable and controller-owning, unlike the immutable `LoadMeasurementModel` it turns
/// into on submit: a half-typed "23." is a legitimate state of a number box, and
/// parsing on every keystroke would eat the decimal point.
class _MeasurementRow {
  _MeasurementRow({required this.kind, required this.phase});

  LoadMeasurementKind kind;
  LoadMeasurementPhase? phase;
  final TextEditingController value = TextEditingController();
}

/// The repeatable reading editor — "Multiple Load Units".
///
/// One line per reading: what was measured, the number, which conductor, and a way to
/// take the row back off. Compact because the whole sheet is filled in one-handed on a
/// phone at a panel.
///
/// ACTIVE_POWER is deliberately not offered. kW is entered in "Хэмжсэн ачаалал" above,
/// which is the authoritative figure the floor totals sum; a second kW box on the same
/// form could produce two different power figures, which the backend would then have to
/// refuse. A kW reading recorded through another client still displays here.
class _MeasurementEditor extends StatelessWidget {
  const _MeasurementEditor({
    required this.rows,
    required this.fieldErrors,
    required this.enabled,
    required this.onAdd,
    required this.onRemove,
    required this.onChanged,
  });

  final List<_MeasurementRow> rows;
  final Map<String, String> fieldErrors;
  final bool enabled;
  final VoidCallback? onAdd;
  final void Function(int index) onRemove;
  final VoidCallback onChanged;

  static final List<LoadMeasurementKind> _addableKinds = LoadMeasurementKind.values
      .where((LoadMeasurementKind kind) => kind != LoadMeasurementKind.activePower)
      .toList(growable: false);

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            const Expanded(child: _Label('Бусад хэмжилт (А, В)')),
            _AddMeasurementButton(onPressed: enabled ? onAdd : null),
          ],
        ),
        if (rows.isEmpty)
          Text(
            'Гүйдэл, хүчдэл хэмжсэн бол мөр нэмнэ үү. Гурван фазын самбарт фаз тус '
            'бүрээр нь тусад нь бүртгэнэ.',
            style: EmployeeTokens.microNote.copyWith(height: 1.5),
          ),
        for (int index = 0; index < rows.length; index++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _MeasurementRowEditor(
              // Keyed as well as labelled: the semantics label is what a screen reader
              // reads, the key is what survives the sheet's list rebuilding a row.
              key: ValueKey<String>('measurement-row-$index'),
              index: index,
              row: rows[index],
              enabled: enabled,
              error: fieldErrors['measurements.$index.value'] ??
                  fieldErrors['measurements.$index.unit'] ??
                  fieldErrors['measurements.$index.phase'],
              label: '${index + 1}-р хэмжилт',
              onRemove: () => onRemove(index),
              onChanged: onChanged,
            ),
          ),
      ],
    );
  }
}

class _AddMeasurementButton extends StatelessWidget {
  const _AddMeasurementButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final bool active = onPressed != null;
    return Material(
      color: EmployeeTokens.white,
      borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            border: Border.all(
              color: active ? EmployeeTokens.line : EmployeeTokens.faint,
              width: EmployeeTokens.hairline,
            ),
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.add,
                size: 14,
                color: active ? EmployeeTokens.ink : EmployeeTokens.muted,
              ),
              const SizedBox(width: 5),
              Text(
                'Хэмжилт нэмэх',
                style: EmployeeTokens.rowSub.copyWith(
                  fontWeight: FontWeight.w700,
                  color: active ? EmployeeTokens.ink : EmployeeTokens.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MeasurementRowEditor extends StatelessWidget {
  const _MeasurementRowEditor({
    super.key,
    required this.index,
    required this.row,
    required this.enabled,
    required this.error,
    required this.label,
    required this.onRemove,
    required this.onChanged,
  });

  final int index;
  final _MeasurementRow row;
  final bool enabled;
  final String? error;

  /// `2-р хэмжилт` — what a screen reader announces this row as.
  final String label;
  final VoidCallback onRemove;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              flex: 5,
              child: _MeasurementDropdown<LoadMeasurementKind>(
                label: '$label: төрөл',
                value: row.kind,
                enabled: enabled,
                items: <(LoadMeasurementKind, String)>[
                  for (final LoadMeasurementKind kind
                      in _MeasurementEditor._addableKinds)
                    (kind, '${kind.label} (${kind.unit.label})'),
                ],
                onChanged: (LoadMeasurementKind? picked) {
                  if (picked == null) return;
                  row.kind = picked;
                  // A kind that carries no phase must not keep the previous one.
                  if (!picked.acceptsPhase) row.phase = null;
                  onChanged();
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 3,
              child: Semantics(
                label: '$label: утга',
                child: TextField(
                  key: ValueKey<String>('measurement-value-$index'),
                  controller: row.value,
                  enabled: enabled,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
                  decoration: InputDecoration(
                    hintText: '0.0',
                    hintStyle:
                        EmployeeTokens.body.copyWith(color: EmployeeTokens.muted),
                    filled: true,
                    fillColor: error == null
                        ? EmployeeTokens.white
                        : EmployeeTokens.redBg,
                    isDense: true,
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                    border: _measurementBorder(error != null),
                    enabledBorder: _measurementBorder(error != null),
                    focusedBorder: _measurementBorder(error != null, focused: true),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 4,
              child: _MeasurementDropdown<LoadMeasurementPhase?>(
                label: '$label: фаз',
                value: row.phase,
                enabled: enabled && row.kind.acceptsPhase,
                items: <(LoadMeasurementPhase?, String)>[
                  (null, 'Фазгүй'),
                  for (final LoadMeasurementPhase phase
                      in LoadMeasurementPhase.values)
                    (phase, phase.wireValue),
                ],
                onChanged: (LoadMeasurementPhase? picked) {
                  row.phase = picked;
                  onChanged();
                },
              ),
            ),
            Semantics(
              label: '$label: хасах',
              button: true,
              child: IconButton(
                key: ValueKey<String>('measurement-remove-$index'),
                onPressed: enabled ? onRemove : null,
                icon: const Icon(Icons.close, size: 18),
                color: EmployeeTokens.red,
                visualDensity: VisualDensity.compact,
                tooltip: 'Хасах',
              ),
            ),
          ],
        ),
        if (error != null) _ErrorLine(error!),
      ],
    );
  }
}

OutlineInputBorder _measurementBorder(bool hasError, {bool focused = false}) {
  return OutlineInputBorder(
    borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
    borderSide: BorderSide(
      color: hasError
          ? EmployeeTokens.red
          : (focused ? EmployeeTokens.ink : EmployeeTokens.line),
      width: EmployeeTokens.hairline,
    ),
  );
}

/// The sheet's own dropdown, matching `_SheetField`'s box rather than Material's.
class _MeasurementDropdown<T> extends StatelessWidget {
  const _MeasurementDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final T value;
  final List<(T, String)> items;
  final bool enabled;
  final ValueChanged<T?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: enabled ? EmployeeTokens.white : EmployeeTokens.soft2,
          border: Border.all(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<T>(
            value: value,
            isExpanded: true,
            isDense: true,
            padding: const EdgeInsets.symmetric(vertical: 8),
            iconSize: 18,
            style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
            items: <DropdownMenuItem<T>>[
              for (final (T option, String text) in items)
                DropdownMenuItem<T>(
                  value: option,
                  child: Text(text, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: enabled ? onChanged : null,
          ),
        ),
      ),
    );
  }
}

/// The evidence row: what has been uploaded, plus the capture tile.
///
/// The thumbnails come from the bytes still in memory rather than from
/// `GET /files/:fileId`. Re-downloading a picture the handset took seconds ago would
/// cost a field connection a round trip for an image it already holds.
class _PhotoRow extends StatelessWidget {
  const _PhotoRow({
    required this.photos,
    required this.thumbnails,
    required this.busy,
    required this.onAdd,
  });

  final List<ObjectPhotoModel> photos;
  final Map<String, Uint8List> thumbnails;
  final bool busy;
  final VoidCallback? onAdd;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 66,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: photos.length + 1,
        separatorBuilder: (BuildContext _, int __) => const SizedBox(width: 8),
        itemBuilder: (BuildContext _, int index) {
          if (index == photos.length) {
            return _AddTile(busy: busy, onTap: onAdd);
          }

          final Uint8List? bytes = thumbnails[photos[index].id];
          return Container(
            width: 66,
            height: 66,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: EmployeeTokens.soft2,
              border: Border.all(color: EmployeeTokens.faint),
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
            ),
            child: bytes == null
                ? const Icon(
                    Icons.image_outlined,
                    size: 18,
                    color: EmployeeTokens.muted,
                  )
                : Image.memory(
                    bytes,
                    fit: BoxFit.cover,
                    errorBuilder: (BuildContext _, Object __, StackTrace? ___) =>
                        const Icon(
                      Icons.broken_image_outlined,
                      size: 18,
                      color: EmployeeTokens.muted,
                    ),
                  ),
          );
        },
      ),
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
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: Container(
          width: 66,
          height: 66,
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
                  width: 17,
                  height: 17,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(
                      Icons.add_a_photo_outlined,
                      size: 19,
                      color:
                          onTap == null ? EmployeeTokens.muted : EmployeeTokens.ink,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Зураг',
                      style: EmployeeTokens.microLabel.copyWith(letterSpacing: 0),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

/// "Засвар шаардлагатай".
///
/// The one half of the section 9.3 revisit rule this app can answer: ticking it
/// satisfies the yellow-band requirement that either a repair or a revisit date be
/// recorded, and it raises the REPAIR_REQUIRED notification server-side.
class _RepairToggle extends StatelessWidget {
  const _RepairToggle({
    required this.value,
    required this.onChanged,
    required this.error,
  });

  final bool value;
  final ValueChanged<bool>? onChanged;
  final String? error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            border: Border.all(
              color: error == null ? EmployeeTokens.line : EmployeeTokens.red,
              width: EmployeeTokens.hairline,
            ),
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Засвар шаардлагатай',
                  style: EmployeeTokens.detailValue,
                ),
              ),
              Switch.adaptive(
                value: value,
                onChanged: onChanged,
                activeTrackColor: EmployeeTokens.ink,
              ),
            ],
          ),
        ),
        if (error != null) _ErrorLine(error!),
      ],
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text.toUpperCase(),
        style: EmployeeTokens.sectionLabel.copyWith(letterSpacing: 0.6),
      ),
    );
  }
}

/// The tinted refusal block, in the sheet's own padding rather than the tab's
/// gutter — `project_ui.dart`'s banner carries a 14px horizontal margin meant for a
/// full-width screen and would sit indented inside a sheet.
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.text, required this.icon});

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: EmployeeTokens.redBg,
        border: Border.all(color: EmployeeTokens.redBorder),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 16, color: EmployeeTokens.red),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              text,
              style: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.ink2, height: 1.6),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  const _ErrorLine(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 5),
      child: Text(
        text,
        style: EmployeeTokens.rowSub.copyWith(
          fontWeight: FontWeight.w600,
          color: EmployeeTokens.red,
        ),
      ),
    );
  }
}

class _SheetField extends StatelessWidget {
  const _SheetField({
    required this.controller,
    required this.hint,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
    this.error,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String hint;
  final int maxLines;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final String? error;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final bool hasError = error != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        TextField(
          controller: controller,
          enabled: enabled,
          maxLines: maxLines,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: EmployeeTokens.body.copyWith(color: EmployeeTokens.muted),
            filled: true,
            fillColor: hasError ? EmployeeTokens.redBg : EmployeeTokens.white,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: const BorderSide(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: BorderSide(
                color: hasError ? EmployeeTokens.red : EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: BorderSide(
                color: hasError ? EmployeeTokens.red : EmployeeTokens.ink,
                width: EmployeeTokens.hairline,
              ),
            ),
          ),
        ),
        if (hasError) _ErrorLine(error!),
      ],
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({
    required this.busy,
    required this.canSave,
    required this.onCancel,
    required this.onSave,
  });

  final bool busy;
  final bool canSave;
  final VoidCallback? onCancel;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        12 + MediaQuery.viewPaddingOf(context).bottom,
      ),
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (!canSave && !busy)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Зураг хавсаргасны дараа үнэлгээг хадгалах боломжтой болно.',
                style: EmployeeTokens.microNote,
              ),
            ),
          Row(
            children: <Widget>[
              Expanded(
                child: _FooterButton(
                  label: 'Болих',
                  onPressed: onCancel,
                  secondary: true,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: _FooterButton(
                  label: 'Үнэлгээ хадгалах',
                  icon: Icons.check,
                  busy: busy,
                  onPressed: canSave ? onSave : null,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FooterButton extends StatelessWidget {
  const _FooterButton({
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.secondary = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;
  final bool secondary;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPressed != null && !busy;
    final Color background = secondary
        ? EmployeeTokens.white
        : (enabled ? EmployeeTokens.ink : EmployeeTokens.soft);
    final Color foreground = secondary
        ? (enabled ? EmployeeTokens.ink : EmployeeTokens.muted)
        : (enabled ? EmployeeTokens.white : EmployeeTokens.muted);

    return Material(
      color: background,
      borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
      child: InkWell(
        onTap: enabled ? onPressed : null,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
            border: Border.all(
              color: secondary
                  ? (enabled ? EmployeeTokens.line : EmployeeTokens.faint)
                  : background,
              width: EmployeeTokens.hairline,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              if (busy)
                SizedBox(
                  width: 15,
                  height: 15,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(foreground),
                  ),
                )
              else if (icon != null)
                Icon(icon, size: 16, color: foreground),
              if (busy || icon != null) const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.rowTitle.copyWith(
                    fontWeight: FontWeight.w800,
                    color: foreground,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
