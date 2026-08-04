import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../../core/network/paginated_data.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../project/data/models/object_models.dart';
import '../../../project/domain/entities/object_enums.dart';
import '../../../project/data/models/project_models.dart';
import '../../../project/presentation/providers/project_providers.dart';
import '../../data/models/work_report_model.dart';
import 'work_providers.dart';

/// The service-request conclusion editor.
///
/// ONE state source. Every value the editor shows — the equipment selection, each finding,
/// the overall narrative, the evidence — lives in [ConclusionEditorState] and is written
/// back through the same repository the rest of the tab uses. A second store holding
/// half-typed values beside the loaded report is exactly how the two diverge, so there
/// isn't one: the notifier owns the working copy and the server owns the saved copy.

/// What the technician may do with a conclusion, read from the live permission set.
///
/// Never inferred from the role. `resolveEffectivePermissions` returns the union of the
/// account's dynamic roles, and `seedRbac` is prune-only, so a deployed role can hold
/// strictly less than the shipped default. The server remains authoritative; this only
/// decides whether a control is drawn rather than shown and refused.
class ConclusionGrants {
  const ConclusionGrants(this._permissions);

  final Set<String> _permissions;

  /// Reading the request at all.
  bool get canViewRequest => _permissions.contains(PermissionKeys.serviceRequestView);

  /// Writing and submitting the conclusion. `service_request.update` is the key the
  /// backend's own PUT and /submit routes ask for.
  bool get canAuthor => _permissions.contains(PermissionKeys.serviceRequestUpdate);

  /// The OFFICE's full authority over a request — every transition, and approving AND
  /// returning a conclusion.
  ///
  /// Read so a dispatcher or a manager signed into this app is not narrowed by the field
  /// rules below; it is never what a technician's controls are gated on, because the field
  /// tier does not hold it and never will.
  bool get canReview => _permissions.contains(PermissionKeys.serviceRequestChangeStatus);

  /// Saying where the job has got to: the six states in
  /// `ServiceRequestStatus.isSelfProgress`, and nothing else.
  ///
  /// [canReview] counts too, because the office key is a strict superset — a control
  /// gated on the narrow key alone would disappear for the one population that has always
  /// been able to use it.
  bool get canSelfProgress =>
      _permissions.contains(PermissionKeys.serviceRequestSelfProgress) || canReview;

  /// Settling a submitted conclusion. APPROVE only — returning one is not offered by this
  /// app at all, and `service_request.approve_report` could not reach it if it were.
  bool get canApproveConclusion =>
      _permissions.contains(PermissionKeys.serviceRequestApproveReport) || canReview;

  /// True once the permission array has actually arrived, so a screen can tell "no
  /// grants" apart from "not asked yet".
  ///
  /// The set is empty between login and the first `/auth/me`. Every gate above reads false
  /// until then and a control stays hidden — but the EXPLANATION beside it must not claim
  /// a permission is missing when nobody has looked yet.
  bool get isKnown => _permissions.isNotEmpty;
}

final Provider<ConclusionGrants> conclusionGrantsProvider = Provider<ConclusionGrants>(
  (Ref ref) => ConclusionGrants(ref.watch(currentUserProvider)?.permissions ?? const <String>{}),
);

/// How a piece of equipment came to be in the editor.
enum EquipmentOrigin {
  /// Loaded from a saved `ReportItem` — it already carries a finding.
  assessed,

  /// Named by the conclusion but not yet written up. A real draft state.
  selected,

  /// Referenced by a saved item, but no longer readable on its floor.
  ///
  /// Kept visible and READ-ONLY rather than dropped: silently discarding it would delete a
  /// finding the server still holds, and the technician would have no way to know.
  unavailable,
}

/// One equipment card's working values.
class EquipmentDraft {
  const EquipmentDraft({
    required this.objectId,
    required this.origin,
    required this.photoIds,
    this.code,
    this.name,
    this.typeName,
    this.floorName,
    this.currentRiskWire,
    this.currentScore,
    this.score,
    this.observation = '',
    this.conclusion = '',
    this.recommendation = '',
  });

  final String objectId;
  final EquipmentOrigin origin;

  // -- Context, so the wrong object is not assessed --------------------------
  final String? code;
  final String? name;
  final String? typeName;
  final String? floorName;

  /// The equipment's CURRENT standing, which the server computed. Distinct from the score
  /// being entered now, and the only band this editor prints.
  final String? currentRiskWire;
  final int? currentScore;

  // -- The finding being written ---------------------------------------------
  final String? score;
  final String observation;
  final String conclusion;
  final String recommendation;
  final List<String> photoIds;

  String get label => (code ?? '').isEmpty ? (name ?? objectId) : '$code · ${name ?? ''}';

  /// True when the technician has actually said something about this object.
  ///
  /// Drives two rules: the warning before removing a card, and the decision not to send an
  /// assessment for an object that carries nothing. An empty entry would become a
  /// `ReportItem` asserting a finding nobody made.
  bool get hasData =>
      (score ?? '').trim().isNotEmpty ||
      observation.trim().isNotEmpty ||
      conclusion.trim().isNotEmpty ||
      recommendation.trim().isNotEmpty ||
      photoIds.isNotEmpty;

  bool get isReadOnly => origin == EquipmentOrigin.unavailable;

  EquipmentDraft copyWith({
    String? score,
    String? observation,
    String? conclusion,
    String? recommendation,
    List<String>? photoIds,
    EquipmentOrigin? origin,
  }) {
    return EquipmentDraft(
      objectId: objectId,
      origin: origin ?? this.origin,
      code: code,
      name: name,
      typeName: typeName,
      floorName: floorName,
      currentRiskWire: currentRiskWire,
      currentScore: currentScore,
      score: score ?? this.score,
      observation: observation ?? this.observation,
      conclusion: conclusion ?? this.conclusion,
      recommendation: recommendation ?? this.recommendation,
      photoIds: photoIds ?? this.photoIds,
    );
  }
}

/// Which of the conclusion's two visit-level photo sets a capture belongs to.
///
/// A visit photograph is not equipment evidence: the server stores these on the report and
/// checks them as `BEFORE_PHOTO` and `AFTER_PHOTO`, while a card's photos hang off its
/// item and satisfy neither. The two are separate slots here for the same reason.
enum VisitPhotoSlot {
  before('Ажлын өмнөх зураг'),
  after('Ажлын дараах зураг');

  const VisitPhotoSlot(this.label);

  final String label;

  /// The key [ConclusionEditorState.uploadingFor] carries while this slot is uploading.
  ///
  /// Prefixed so it can never collide with an object id, which is what that field
  /// otherwise holds.
  String get uploadKey => 'visit:$name';
}

class ConclusionEditorState {
  const ConclusionEditorState({
    required this.report,
    required this.drafts,
    required this.conclusion,
    required this.recommendation,
    required this.beforePhotoIds,
    required this.afterPhotoIds,
    this.score = '',
    this.saving = false,
    this.uploadingFor,
    this.message,
    this.failed = false,
    this.itemErrors = const <String, String>{},
    this.missing = const <WorkReportRequirement>[],
  });

  final WorkReportModel report;

  /// Ordered so the cards do not reshuffle as values are typed.
  final List<EquipmentDraft> drafts;

  /// The visit's own score, as typed. Held as text so a half-entered "1" is not read as a
  /// score of 1 and so an emptied field clears rather than sticking at its last number.
  final String score;
  final String conclusion;
  final String recommendation;

  /// The visit's two evidence sets, as the working copy rather than as loaded: a photo
  /// added or removed here must survive until the next save, and reading them back off
  /// [report] is what previously made both sets impossible to change from this app.
  final List<String> beforePhotoIds;
  final List<String> afterPhotoIds;

  final bool saving;

  /// The object — or [VisitPhotoSlot.uploadKey] — whose upload is in flight, so only that
  /// strip shows progress.
  final String? uploadingFor;

  final String? message;
  final bool failed;

  /// Server refusals keyed by objectId, printed against the card they belong to.
  final Map<String, String> itemErrors;

  /// The mandatory VISIT-LEVEL fields the server says are still empty.
  ///
  /// The server's own answer, never recomputed here: `workReportCompleteness` is the one
  /// authority on what "бүрэн" means, and a second local rule would eventually disagree
  /// with it. Refreshed from every save response and from a refused submission, so it
  /// names what is missing right now rather than at load.
  final List<WorkReportRequirement> missing;

  bool get isEditable => report.status.isEditable;

  /// True when nothing would produce a ReportItem, which is what keeps the conclusion out
  /// of Үзлэг ба дүгнэлт.
  bool get hasNoEquipment => drafts.isEmpty;

  bool isMissing(WorkReportRequirement requirement) => missing.contains(requirement);

  ConclusionEditorState copyWith({
    WorkReportModel? report,
    List<EquipmentDraft>? drafts,
    String? score,
    String? conclusion,
    String? recommendation,
    List<String>? beforePhotoIds,
    List<String>? afterPhotoIds,
    bool? saving,
    String? uploadingFor,
    bool clearUploading = false,
    String? message,
    bool? failed,
    Map<String, String>? itemErrors,
    List<WorkReportRequirement>? missing,
  }) {
    return ConclusionEditorState(
      report: report ?? this.report,
      drafts: drafts ?? this.drafts,
      score: score ?? this.score,
      conclusion: conclusion ?? this.conclusion,
      recommendation: recommendation ?? this.recommendation,
      beforePhotoIds: beforePhotoIds ?? this.beforePhotoIds,
      afterPhotoIds: afterPhotoIds ?? this.afterPhotoIds,
      saving: saving ?? this.saving,
      uploadingFor: clearUploading ? null : (uploadingFor ?? this.uploadingFor),
      message: message,
      failed: failed ?? false,
      itemErrors: itemErrors ?? this.itemErrors,
      missing: missing ?? this.missing,
    );
  }
}

/// Which request's conclusion, and where its equipment lives.
typedef ConclusionRef = ({String requestId, String? buildingId});

final AsyncNotifierProviderFamily<ConclusionEditor, ConclusionEditorState, ConclusionRef>
    conclusionEditorProvider = AsyncNotifierProvider.family<ConclusionEditor,
        ConclusionEditorState, ConclusionRef>(ConclusionEditor.new);

class ConclusionEditor extends FamilyAsyncNotifier<ConclusionEditorState, ConclusionRef> {
  @override
  Future<ConclusionEditorState> build(ConclusionRef arg) async {
    final WorkReportModel report = _unwrapResult(
      await ref.read(workRepositoryProvider).getWorkReport(arg.requestId),
    );
    return _hydrate(report);
  }

  /// Rebuilds the working copy from a saved report.
  ///
  /// Three distinct origins come out of this, and conflating any two of them loses
  /// information the technician needs: an object with a saved finding, one merely named,
  /// and one whose finding survives but whose equipment no longer resolves.
  ConclusionEditorState _hydrate(WorkReportModel report) {
    final Map<String, WorkReportObjectModel> named = <String, WorkReportObjectModel>{
      for (final WorkReportObjectModel object in report.objects) object.id: object,
    };

    final List<EquipmentDraft> drafts = <EquipmentDraft>[];

    for (final WorkReportObjectAssessmentModel item in report.objectAssessments) {
      final WorkReportObjectModel? object = named.remove(item.objectId);
      drafts.add(
        EquipmentDraft(
          objectId: item.objectId,
          // The membership list is what proves the object still resolves: the server
          // populates it from the object master, so an id present in the findings but
          // absent from `objects` is equipment that has gone away.
          origin: object == null ? EquipmentOrigin.unavailable : EquipmentOrigin.assessed,
          code: item.code ?? object?.code,
          name: item.name ?? object?.name,
          score: item.score?.toString(),
          observation: item.observation ?? '',
          conclusion: item.conclusion ?? '',
          recommendation: item.recommendation ?? '',
          photoIds: List<String>.from(item.photoIds),
        ),
      );
    }

    for (final WorkReportObjectModel object in named.values) {
      drafts.add(
        EquipmentDraft(
          objectId: object.id,
          origin: EquipmentOrigin.selected,
          code: object.code,
          name: object.name,
          photoIds: const <String>[],
        ),
      );
    }

    return ConclusionEditorState(
      report: report,
      drafts: drafts,
      score: report.score?.toString() ?? '',
      conclusion: report.conclusion ?? '',
      recommendation: report.recommendation ?? '',
      beforePhotoIds:
          report.beforePhotos.map((WorkReportPhotoModel photo) => photo.id).toList(),
      afterPhotoIds:
          report.afterPhotos.map((WorkReportPhotoModel photo) => photo.id).toList(),
      missing: WorkReportRequirement.values
          .where((WorkReportRequirement requirement) =>
              report.missing.contains(requirement.wireValue))
          .toList(),
    );
  }

  ConclusionEditorState get _now => state.requireValue;

  void _set(ConclusionEditorState next) => state = AsyncData<ConclusionEditorState>(next);

  // -- Editing ---------------------------------------------------------------

  void setScore(String value) => _set(_now.copyWith(score: value));

  void setConclusion(String value) => _set(_now.copyWith(conclusion: value));

  void setRecommendation(String value) => _set(_now.copyWith(recommendation: value));

  /// Updates one card without touching any other.
  ///
  /// The list is rebuilt by identity rather than index, so a card keeps its values when
  /// another is added or removed — which is what "preserve entered values when switching
  /// between selected objects" actually requires.
  void patchDraft(
    String objectId, {
    String? score,
    String? observation,
    String? conclusion,
    String? recommendation,
    List<String>? photoIds,
  }) {
    _set(
      _now.copyWith(
        drafts: _now.drafts
            .map(
              (EquipmentDraft draft) => draft.objectId == objectId
                  ? draft.copyWith(
                      score: score,
                      observation: observation,
                      conclusion: conclusion,
                      recommendation: recommendation,
                      photoIds: photoIds,
                    )
                  : draft,
            )
            .toList(),
      ),
    );
  }

  /// Adds equipment chosen from a floor. Already-selected objects are ignored, so tapping
  /// twice cannot produce two cards for one panel.
  void addEquipment(Iterable<ObjectListItemModel> objects) {
    final Set<String> present =
        _now.drafts.map((EquipmentDraft draft) => draft.objectId).toSet();

    final List<EquipmentDraft> added = objects
        .where((ObjectListItemModel object) => !present.contains(object.id))
        .map(
          (ObjectListItemModel object) => EquipmentDraft(
            objectId: object.id,
            origin: EquipmentOrigin.selected,
            code: object.code,
            name: object.name,
            typeName: object.objectType?.name,
            floorName: object.floorName,
            currentRiskWire: object.latestAssessment?.riskLevel?.wireValue,
            currentScore: object.latestAssessment?.score,
            photoIds: const <String>[],
          ),
        )
        .toList();

    if (added.isEmpty) return;
    _set(_now.copyWith(drafts: <EquipmentDraft>[..._now.drafts, ...added]));
  }

  void removeEquipment(String objectId) {
    _set(
      _now.copyWith(
        drafts: _now.drafts
            .where((EquipmentDraft draft) => draft.objectId != objectId)
            .toList(),
      ),
    );
  }

  // -- Evidence --------------------------------------------------------------

  Future<String?> attachPhoto(String objectId, CapturedPhoto photo) async {
    _set(_now.copyWith(uploadingFor: objectId));

    final ApiResult<WorkReportPhotoModel> result =
        await ref.read(workRepositoryProvider).uploadWorkReportPhoto(photo);

    return result.when(
      success: (WorkReportPhotoModel uploaded) {
        final EquipmentDraft? draft = _now.drafts
            .where((EquipmentDraft entry) => entry.objectId == objectId)
            .firstOrNull;
        _set(_now.copyWith(clearUploading: true));
        if (draft != null) {
          patchDraft(
            objectId,
            photoIds: <String>[...draft.photoIds, uploaded.id],
          );
        }
        return null;
      },
      failure: (Failure failure) {
        _set(_now.copyWith(clearUploading: true, message: failure.message, failed: true));
        return failure.message;
      },
    );
  }

  /// Drops an attachment from the working copy.
  ///
  /// Only ever removes the reference. The file itself is parked on the uploader until a
  /// save claims it, so an unsaved photo simply stays unreferenced — there is nothing to
  /// delete and no request to make.
  void removePhoto(String objectId, String photoId) {
    final EquipmentDraft? draft =
        _now.drafts.where((EquipmentDraft entry) => entry.objectId == objectId).firstOrNull;
    if (draft == null) return;
    patchDraft(
      objectId,
      photoIds: draft.photoIds.where((String id) => id != photoId).toList(),
    );
  }

  /// Attaches a photograph to the VISIT rather than to a piece of equipment.
  ///
  /// The same two-step upload the equipment strips use — the file is parked on the uploader
  /// and only the id is held — but landing in `beforePhotoIds`/`afterPhotoIds`, which are
  /// the two lists `workReportCompleteness` actually counts.
  Future<String?> attachVisitPhoto(VisitPhotoSlot slot, CapturedPhoto photo) async {
    _set(_now.copyWith(uploadingFor: slot.uploadKey));

    final ApiResult<WorkReportPhotoModel> result =
        await ref.read(workRepositoryProvider).uploadWorkReportPhoto(photo);

    return result.when(
      success: (WorkReportPhotoModel uploaded) {
        final ConclusionEditorState now = _now;
        _set(
          now.copyWith(
            clearUploading: true,
            beforePhotoIds: slot == VisitPhotoSlot.before
                ? <String>[...now.beforePhotoIds, uploaded.id]
                : null,
            afterPhotoIds: slot == VisitPhotoSlot.after
                ? <String>[...now.afterPhotoIds, uploaded.id]
                : null,
          ),
        );
        return null;
      },
      failure: (Failure failure) {
        _set(_now.copyWith(clearUploading: true, message: failure.message, failed: true));
        return failure.message;
      },
    );
  }

  void removeVisitPhoto(VisitPhotoSlot slot, String photoId) {
    final ConclusionEditorState now = _now;
    List<String> without(List<String> ids) =>
        ids.where((String id) => id != photoId).toList();

    _set(
      now.copyWith(
        beforePhotoIds: slot == VisitPhotoSlot.before ? without(now.beforePhotoIds) : null,
        afterPhotoIds: slot == VisitPhotoSlot.after ? without(now.afterPhotoIds) : null,
      ),
    );
  }

  // -- Writing ---------------------------------------------------------------

  SaveWorkReportRequest _payload() {
    final ConclusionEditorState now = _now;

    return SaveWorkReportRequest(
      // The VISIT's own score, which is a separate mandatory field from every card's. It
      // was hard-coded null here, so `SCORE` could never leave `missing` and no conclusion
      // written on this app could ever be submitted.
      score: int.tryParse(now.score.trim()),
      conclusion: now.conclusion.trim().isEmpty ? null : now.conclusion.trim(),
      recommendation:
          now.recommendation.trim().isEmpty ? null : now.recommendation.trim(),
      actionTaken: null,
      // Membership carries every card, including one not yet written up, so a selection
      // survives a save and can be filled in later.
      objectIds: now.drafts.map((EquipmentDraft draft) => draft.objectId).toList(),
      // Findings carry only the cards that actually say something. An empty card would
      // otherwise become a ReportItem asserting a finding nobody made — and would drag the
      // conclusion into Үзлэг ба дүгнэлт on the strength of a placeholder.
      objectAssessments: now.drafts
          .where((EquipmentDraft draft) => draft.hasData)
          .map(
            (EquipmentDraft draft) => SaveObjectAssessment(
              objectId: draft.objectId,
              score: int.tryParse((draft.score ?? '').trim()),
              observation: draft.observation.trim().isEmpty ? null : draft.observation.trim(),
              conclusion: draft.conclusion.trim().isEmpty ? null : draft.conclusion.trim(),
              recommendation:
                  draft.recommendation.trim().isEmpty ? null : draft.recommendation.trim(),
              photoIds: draft.photoIds,
            ),
          )
          .toList(),
      // The working copy, not what was loaded: echoing `report.beforePhotos` back meant a
      // photo added on this screen was never sent and a removed one came straight back.
      beforePhotoIds: now.beforePhotoIds,
      afterPhotoIds: now.afterPhotoIds,
    );
  }

  /// Saves the draft. Returns null on success, or the refusal to show.
  Future<String?> save() async {
    _set(_now.copyWith(saving: true, itemErrors: const <String, String>{}));

    final ApiResult<WorkReportModel> result = await ref
        .read(workRepositoryProvider)
        .saveWorkReport(arg.requestId, _payload());

    return result.when(
      success: (WorkReportModel saved) {
        // Re-hydrated from the response rather than kept as typed: the server assigns ids
        // and may normalise values, and showing the local guess would be a different
        // record from the stored one.
        _set(_hydrate(saved).copyWith(message: 'Дүгнэлт хадгалагдлаа.'));
        return null;
      },
      failure: (Failure failure) {
        _set(_now.copyWith(saving: false, message: _explain(failure), failed: true));
        return _explain(failure);
      },
    );
  }

  /// Saves, then submits. Returns null on success.
  ///
  /// Saved first, always: submission validates what is STORED, so submitting without
  /// saving would check the previous draft and report blockers the technician has already
  /// fixed on screen.
  Future<String?> submit() async {
    final String? saveFailure = await save();
    if (saveFailure != null) return saveFailure;

    _set(_now.copyWith(saving: true));

    final ApiResult<WorkReportModel> result =
        await ref.read(workRepositoryProvider).submitWorkReport(arg.requestId);

    return result.when(
      success: (WorkReportModel submitted) {
        _set(_hydrate(submitted).copyWith(message: 'Хянуулахаар илгээлээ.'));
        return null;
      },
      failure: (Failure failure) {
        final List<WorkReportRequirement> refused = _missingOf(failure);
        _set(
          _now.copyWith(
            saving: false,
            message: _explain(failure, refused),
            failed: true,
            itemErrors: _fieldErrorsOf(failure),
            // Only overwritten when the refusal actually named requirements: a 403 or a
            // network failure says nothing about completeness, and blanking the list on
            // one would tell the technician nothing is missing.
            missing: refused.isEmpty ? null : refused,
          ),
        );
        return _explain(failure, refused);
      },
    );
  }

  void dismissMessage() => _set(_now.copyWith(message: null));
}

/// The server's PER-OBJECT refusals, keyed so each lands on its own card.
///
/// The requirement keys are filtered out rather than passed through: `itemErrors` is looked
/// up by object id, so a `SCORE` entry matched no card and was silently discarded — the
/// server named the missing field and the screen threw it away.
Map<String, String> _fieldErrorsOf(Failure failure) {
  if (failure is! ServerFailure) return const <String, String>{};
  return <String, String>{
    for (final MapEntry<String, String> entry in failure.fieldErrors.entries)
      if (WorkReportRequirement.fromWire(entry.key) == null) entry.key: entry.value,
  };
}

/// The mandatory fields a refusal named, in the order the requirement list declares them.
List<WorkReportRequirement> _missingOf(Failure failure) {
  if (failure is! ServerFailure) return const <WorkReportRequirement>[];
  return WorkReportRequirement.values
      .where((WorkReportRequirement requirement) =>
          failure.fieldErrors.containsKey(requirement.wireValue))
      .toList();
}

/// A refusal in the words the technician needs.
///
/// A 403 and a stale-conflict are distinct outcomes with distinct remedies, and reporting
/// either as "сүлжээний алдаа" would send somebody to check their signal over a permission
/// problem.
///
/// AN INCOMPLETE-CONCLUSION REFUSAL NAMES THE FIELDS. "Дүгнэлт дутуу тул илгээх боломжгүй."
/// on its own is unactionable — it is the whole complaint — so the server's own list is
/// appended to it here as well as being marked against each control.
String _explain(Failure failure, [List<WorkReportRequirement> missing = const <WorkReportRequirement>[]]) {
  if (missing.isNotEmpty) {
    final String named = missing
        .map((WorkReportRequirement requirement) => requirement.label)
        .join(', ');
    return 'Дутуу байна: $named. Эдгээрийг бөглөөд дахин илгээнэ үү.';
  }
  if (failure is ServerFailure) {
    switch (failure.code) {
      case 'FORBIDDEN':
      case 'INSUFFICIENT_PRIVILEGES':
        return 'Танд энэ дүгнэлтийг бичих эрх байхгүй байна. Администратортой холбогдоно уу.';
      case 'DUPLICATE_KEY':
        return 'Энэ дүгнэлтийг өөр хүн саяхан өөрчилсөн байна. Дахин нээж шалгана уу.';
      default:
        return failure.message;
    }
  }
  return failure.message;
}

T _unwrapResult<T>(ApiResult<T> result) => result.when(
      success: (T data) => data,
      failure: (Failure failure) => throw failure,
    );

// -- Equipment pickers --------------------------------------------------------

/// Floors of the request's building.
///
/// Reuses the project feature's repository rather than adding a second floor read: the
/// route, the model and the tenant scoping are already there, and a duplicate would be a
/// second definition of "which floors exist".
final FutureProviderFamily<List<FloorModel>, String> conclusionFloorsProvider =
    FutureProvider.family<List<FloorModel>, String>((Ref ref, String buildingId) async {
  final PaginatedData<FloorModel> page =
      _unwrapResult(await ref.watch(projectRepositoryProvider).listFloors(buildingId));
  return page.items;
});

/// Equipment on one floor, filtered to what may actually be assessed.
///
/// Decommissioned equipment is excluded: it is not in service, so a fresh finding about it
/// is not a thing a technician should be recording. Anything the caller may not read never
/// arrives here at all — the route is tenant-scoped server-side.
final FutureProviderFamily<List<ObjectListItemModel>, String> conclusionEquipmentProvider =
    FutureProvider.family<List<ObjectListItemModel>, String>((Ref ref, String floorId) async {
  final PaginatedData<ObjectListItemModel> page =
      _unwrapResult(await ref.watch(projectRepositoryProvider).listFloorObjects(floorId));
  return page.items
      .where((ObjectListItemModel object) => object.status != ObjectStatus.decommissioned)
      .toList();
});
