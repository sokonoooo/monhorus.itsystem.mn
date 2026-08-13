import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/util/json_parse.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../project/data/models/project_models.dart';
import '../../../project/presentation/providers/project_providers.dart';
import '../../../project/presentation/widgets/authenticated_image.dart';
import '../../../project/presentation/widgets/floor_plan_markers.dart';
import '../../../shared/service_request_models.dart';
import '../../../shared/service_request_vocabulary.dart';
import '../format.dart';
import '../providers/conclusion_providers.dart';
import '../providers/work_providers.dart';
import '../widgets/request_attachment_gallery.dart';
import '../widgets/work_ui.dart';
import 'conclusion_editor_screen.dart';

/// One service request, in full, and the way into its conclusion.
///
/// THE CONCLUSION FORM IS NOT ON THIS SCREEN. `GET /service-requests/:id/report` creates
/// the draft on first read and attributes it to the caller, so a form rendered here would
/// make every technician who merely opened a request its author. The actions below are
/// therefore the only way in, and each is an explicit tap.
///
/// IT DOES FETCH, and it must. This screen used to render purely from the list row it was
/// handed, on the reasoning that a technician's facts were all on that row. They are not:
/// `ServiceRequestListItemDto` carries no `description`, no `contactName`, no
/// `contactPhone` and no `attachments`, so the screen could show a location and a
/// deadline and nothing whatever about the fault — not the customer's account of it, not
/// who to call at the site, not the photographs they attached. All four are on
/// `ServiceRequestDetailDto` alone. See [serviceRequestDetailProvider].
///
/// The handed-in row is still taken and still used, as the placeholder the screen opens
/// with, so the number, the subject, the location and the SLA are on screen in the first
/// frame and the read fills in behind them rather than replacing a spinner.
///
/// A 404 IS AN ORDINARY OUTCOME. `GET /service-requests/:id` is assignment-scoped: a
/// caller without an oversight permission may read their own work, their team's, and the
/// unclaimed pool — the last of which is what keeps opening a "Нээлттэй" row working —
/// and anything else answers "missing" rather than "forbidden", deliberately, so the
/// endpoint cannot be used to probe for other people's request ids. It reaches this
/// screen as a null value rather than an error, and is said in a sentence.
class ServiceRequestDetailScreen extends ConsumerWidget {
  const ServiceRequestDetailScreen({
    super.key,
    required this.requestId,
    required this.requestNumber,
    required this.subject,
    required this.location,
    this.buildingId,
    this.buildingName,
    this.statusLabel,
    this.slaLabel,
  });

  final String requestId;
  final String requestNumber;

  /// The list row's own title, shown until the read lands, so the screen is never blank
  /// on open.
  final String subject;

  final String location;
  final String? buildingId;
  final String? buildingName;
  final String? statusLabel;
  final String? slaLabel;

  static Route<void> route({
    required String requestId,
    required String requestNumber,
    required String subject,
    required String location,
    String? buildingId,
    String? buildingName,
    String? statusLabel,
    String? slaLabel,
  }) {
    return MaterialPageRoute<void>(
      builder: (_) => ServiceRequestDetailScreen(
        requestId: requestId,
        requestNumber: requestNumber,
        subject: subject,
        location: location,
        buildingId: buildingId,
        buildingName: buildingName,
        statusLabel: statusLabel,
        slaLabel: slaLabel,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ServiceRequestDetailModel?> read =
        ref.watch(serviceRequestDetailProvider(requestId));
    final ServiceRequestDetailModel? detail = read.valueOrNull;

    // `hasValue` rather than `!isLoading`: a refresh keeps the previous record on screen,
    // and a record that is present is not a 404 no matter what is in flight.
    final bool notFound = read.hasValue && detail == null;
    final Object? error = read.error;

    // The building the conclusion editor needs. Preferred from the record, because the
    // row that opened this screen may have carried none — the Нүүр tab's urgent list
    // passes whatever it happened to have.
    final String? resolvedBuildingId = detail?.building?.id ?? buildingId;
    final String? resolvedBuildingName = detail?.building?.name ?? buildingName;

    // The outcome of a transition, said once. Listened for at the screen's root rather than
    // inside _ProgressSection so the toast survives that section rebuilding itself out of
    // existence when the move it just made changes which transitions are legal.
    ref.listen<RequestActionState>(serviceRequestActionProvider(requestId),
        (RequestActionState? _, RequestActionState next) {
      final String? message = next.message;
      if (message == null) return;
      showWorkToast(
        context,
        message: message,
        tone: next.failed ? EmployeeTokens.red : EmployeeTokens.green,
        icon: next.failed ? Icons.error_outline : Icons.check,
      );
      ref.read(serviceRequestActionProvider(requestId).notifier).dismiss();
    });

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      appBar: AppBar(
        title: Text(detail?.requestNumber ?? requestNumber),
        backgroundColor: EmployeeTokens.white,
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async =>
              ref.invalidate(serviceRequestDetailProvider(requestId)),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              EmployeeTokens.gutter,
              12,
              EmployeeTokens.gutter,
              EmployeeTokens.scrollBottomSpacer,
            ),
            children: <Widget>[
              _SummaryCard(
                detail: detail,
                subject: subject,
                location: location,
                statusLabel: statusLabel,
                slaLabel: slaLabel,
              ),

              if (read.isLoading && detail == null) ...<Widget>[
                const SizedBox(height: 12),
                const _LoadingNotice(),
              ],

              if (notFound) ...<Widget>[
                const SizedBox(height: 12),
                const NoticeBanner(
                  margin: EdgeInsets.zero,
                  tone: EmployeeTokens.yellow,
                  icon: Icons.search_off,
                  title: 'Хүсэлт олдсонгүй',
                  text: 'Энэ хүсэлт танд ч, таны багт ч оногдоогүй бөгөөд нээлттэй '
                      'жагсаалтад ч алга байна. Өөр ажилтанд шилжсэн байж болзошгүй. '
                      'Дээрх мэдээлэл нь жагсаалтаас ирсэн хуучин хувилбар.',
                ),
              ],

              if (error != null) ...<Widget>[
                const SizedBox(height: 12),
                NoticeBanner(
                  margin: EdgeInsets.zero,
                  tone: EmployeeTokens.red,
                  icon: Icons.cloud_off,
                  title: 'Дэлгэрэнгүйг уншиж чадсангүй',
                  text: error is Failure
                      ? error.message
                      : 'Дэлгэрэнгүй мэдээллийг татаж чадсангүй. Дахин оролдоно уу.',
                ),
              ],

              if (detail != null) ...<Widget>[
                const SizedBox(height: 16),
                const FieldLabel('Тайлбар'),
                WorkCard(
                  margin: EdgeInsets.zero,
                  child: Text(
                    detail.description.isEmpty
                        ? 'Тайлбар бичигдээгүй байна.'
                        : detail.description,
                    style: EmployeeTokens.body,
                  ),
                ),

                // Between the fault and the contact, because it answers the question the
                // description raises and the "Байршил" row above cannot: not which floor,
                // but where on it.
                if (detail.planPosition != null &&
                    (detail.floor?.id.isNotEmpty ?? false)) ...<Widget>[
                  const SizedBox(height: 16),
                  const FieldLabel('Гэмтлийн байршил'),
                  _FaultPinSection(
                    floorId: detail.floor!.id,
                    pin: detail.planPosition!,
                  ),
                ],

                const SizedBox(height: 16),
                const FieldLabel('Холбоо барих'),
                WorkCard(
                  margin: EdgeInsets.zero,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      InfoRow(
                        label: 'Хариуцсан хүн',
                        value: detail.contactName.isEmpty
                            ? kNoValue
                            : detail.contactName,
                      ),
                      // Displayed rather than dialled: this app carries no
                      // `url_launcher`, and pulling in a package so that one row can
                      // open the dialler is not a trade this screen gets to make. The
                      // number is selectable, so it can still be lifted out.
                      _PhoneRow(phone: detail.contactPhone),
                    ],
                  ),
                ),

                const SizedBox(height: 16),
                FieldLabel(
                  detail.attachments.isEmpty
                      ? 'Хавсралт'
                      : 'Хавсралт (${detail.attachments.length})',
                ),
                if (detail.attachments.isEmpty)
                  WorkCard(
                    margin: EdgeInsets.zero,
                    child: Text(
                      'Хавсаргасан зураг, файл алга.',
                      style: EmployeeTokens.rowSub,
                    ),
                  )
                else
                  RequestAttachmentGallery(attachments: detail.attachments),
              ],

              const SizedBox(height: 16),
              const FieldLabel('Ажлын явц'),
              _ProgressSection(requestId: requestId, detail: detail),

              const SizedBox(height: 16),
              const FieldLabel('Ажлын дүгнэлт'),
              _ConclusionSection(
                requestId: requestId,
                requestNumber: detail?.requestNumber ?? requestNumber,
                detail: detail,
                stillReading: read.isLoading,
                buildingId: resolvedBuildingId,
                buildingName: resolvedBuildingName,
              ),

              _ApprovalSection(detail: detail),
            ],
          ),
        ),
      ),
    );
  }
}

/// The floor's plan with the reporter's pin on it.
///
/// READ-ONLY, AND NOT NEGOTIABLE. The coordinate is the customer's own account of where
/// their problem is, made on the intake form; there is no gesture, no drag and no clear
/// control here, because a technician who could move it would be editing somebody
/// else's statement of the fault.
///
/// The drawing is fetched separately from the request. `ServiceRequestDetailDto` carries
/// the coordinate but not the picture — the picture belongs to the FLOOR — so this is a
/// second read, [floorPlanProvider], guarded by `object.view`, which the TECHNICIAN role
/// holds. It is deliberately not folded into the request read: a request whose floor has
/// no plan must still render in full.
///
/// `AuthenticatedImage.sizedToImage` rather than the default constructor, and that is
/// the whole reason the pin lands where the customer put it. The default letterboxes the
/// picture inside a fixed-height box, so the painted rectangle is smaller than the
/// widget's and a fraction of the widget would miss the drawing by the height of the
/// bars. Sizing the box from the image makes the two one rectangle, and `x, y` then
/// needs no arithmetic at all.
///
/// THREE WAYS THIS HAS NOTHING TO DRAW, each of which gets a sentence rather than an
/// empty box: the floor has no plan, the plan is a PDF or another non-image, and the
/// read itself failed. A fourth — the bytes arrive but will not decode — is
/// [AuthenticatedImage]'s own and is already said there.
class _FaultPinSection extends ConsumerWidget {
  const _FaultPinSection({required this.floorId, required this.pin});

  final String floorId;
  final PlanPositionModel pin;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<FloorPlanModel?> plan = ref.watch(floorPlanProvider(floorId));

    return plan.when(
      data: (FloorPlanModel? drawing) {
        if (drawing == null) {
          return const _PlanNotice(
            'Захиалагч гэмтлийн байршлыг планд тэмдэглэсэн ч энэ давхарт план '
            'зураг импортлогдоогүй тул харуулах боломжгүй байна.',
          );
        }
        if (!drawing.isImage) {
          return _PlanNotice(
            '${drawing.fileName} нь зураг биш файл тул тэмдэглэгээг энд харуулах '
            'боломжгүй байна.',
          );
        }

        return WorkCard(
          margin: EdgeInsets.zero,
          padding: EdgeInsets.zero,
          child: Container(
            color: EmployeeTokens.white,
            child: AuthenticatedImage.sizedToImage(
              fileId: drawing.fileId,
              overlay: FloorPlanPinLayer(pin: pin),
            ),
          ),
        );
      },
      loading: () => const WorkCard(
        margin: EdgeInsets.zero,
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2.2),
          ),
        ),
      ),
      error: (Object error, StackTrace _) => _PlanNotice(
        error is Failure
            ? error.message
            : 'План зургийг татаж чадсангүй. Дахин оролдоно уу.',
      ),
    );
  }
}

/// One honest line where a drawing would have been.
class _PlanNotice extends StatelessWidget {
  const _PlanNotice(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return WorkCard(
      margin: EdgeInsets.zero,
      child: Text(text, style: EmployeeTokens.rowSub),
    );
  }
}

/// Saying where the job has got to.
///
/// THREE CONDITIONS, ALL OF WHICH MUST HOLD, and the screen says which one failed rather
/// than drawing nothing:
///
///   1. The move is legal from the current status — `SERVICE_REQUEST_TRANSITIONS`.
///   2. It is inside `service_request.self_progress`'s six states. The other eight are the
///      office's: cancelling, un-assigning, returning, verifying, completing, raising a
///      revisit.
///   3. The caller holds the key AND the request is theirs or their team's.
///
/// The first two are one call — [ServiceRequestStatus.selfProgressTargets] — because
/// intersecting them by hand at the call site is how a control ends up offering an edge the
/// graph does not have.
///
/// HIDE, DON'T DISABLE — but never hide in silence. A greyed-out button that never explains
/// itself and a control that simply is not there are the same dead end, and the second one
/// at least does not look broken. Every branch below that withholds the buttons prints the
/// reason beside them, naming the permission where a permission is what is missing. The
/// absence of exactly this is what prompted the question that produced the feature.
class _ProgressSection extends ConsumerWidget {
  const _ProgressSection({required this.requestId, required this.detail});

  final String requestId;
  final ServiceRequestDetailModel? detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ConclusionGrants grants = ref.watch(conclusionGrantsProvider);

    // Between login and the first /auth/me nothing is known. Saying "you lack this
    // permission" then would be a guess presented as a fact.
    if (!grants.isKnown) return const SizedBox.shrink();

    if (!grants.canSelfProgress) {
      return const NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.lock_outline,
        title: 'Төлөв өөрчлөх эрх байхгүй',
        text: 'Танд "service_request.self_progress" эрх байхгүй тул ажлын явцыг '
            'бүртгэх боломжгүй. Хүлээн авсан, замдаа, очсон гэх мэт төлөвийг '
            'диспетчер бүртгэнэ. Эрхээ администратороор нэмүүлнэ үү.',
      );
    }

    final ServiceRequestDetailModel? record = detail;
    // No record means the read has not landed or answered 404. Both are already explained
    // above the fold; repeating it here would be the same sentence twice.
    if (record == null) return const SizedBox.shrink();

    final PlannedWorkAssignment assignment = resolveRequestAssignment(
      request: record,
      identity: ref.watch(workIdentityProvider).valueOrNull,
      grants: ref.watch(workGrantsProvider),
    );

    if (assignment.blocksWrites) {
      return NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.yellow,
        icon: Icons.person_off_outlined,
        title: record.isUnclaimed ? 'Энэ ажлыг эзэмшээгүй байна' : 'Танд оногдоогүй ажил',
        text: record.isUnclaimed
            ? 'Энэ хүсэлт хэн нэгэнд хуваарилагдаагүй байна. Явцыг бүртгэхийн тулд '
                'эхлээд "Нээлттэй" жагсаалтаас өөртөө авна уу.'
            : 'Энэ хүсэлт танд ч, таны багт ч хуваарилагдаагүй тул төлөвийг нь '
                'өөрчлөх боломжгүй.',
      );
    }

    final List<ServiceRequestStatus> targets =
        record.status?.selfProgressTargets ?? const <ServiceRequestStatus>[];

    if (targets.isEmpty) {
      return NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.done_all,
        title: 'Одоогийн төлөвөөс цааш явуулах зүйл алга',
        text: '"${record.status?.label ?? kNoValue}" төлөвөөс гүйцэтгэгчийн хийх '
            'шилжилт үлдээгүй байна. Цуцлах, буцаах, баталгаажуулах, дуусгах зэргийг '
            'зөвхөн оффис хийнэ.',
      );
    }

    final RequestActionState action = ref.watch(serviceRequestActionProvider(requestId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final ServiceRequestStatus to in targets) ...<Widget>[
          // One full-width pill per line. Never a Row child: a WorkButton has no
          // intrinsic width and cannot lay out unconstrained.
          WorkButton.secondary(
            label: '${to.label} болгох',
            icon: Icons.arrow_forward,
            busy: action.pending == to.wireValue,
            onPressed: action.isBusy ? null : () => _move(context, ref, to),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  /// Asks for the reason first where the state requires one.
  ///
  /// WAITING is the only such state a technician can reach, and the prompt is not a
  /// courtesy: `isReasonRequired` refuses the transition outright without it, so sending
  /// the move first and reporting the 400 afterwards would be making the technician
  /// discover a mandatory field by being refused.
  Future<void> _move(
    BuildContext context,
    WidgetRef ref,
    ServiceRequestStatus to,
  ) async {
    String? reason;

    if (to.requiresReason) {
      reason = await _askReason(context, to);
      // Dismissed, so nothing was asked of the server.
      if (reason == null) return;
    }

    await ref
        .read(serviceRequestActionProvider(requestId).notifier)
        .moveTo(to, reason: reason);
  }

  Future<String?> _askReason(BuildContext context, ServiceRequestStatus to) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: EmployeeTokens.white,
      builder: (BuildContext sheetContext) => _ReasonSheet(status: to),
    );
  }
}

/// The reason a paused job has to carry, in the tab's own sheet shape.
class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({required this.status});

  final ServiceRequestStatus status;

  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  final TextEditingController _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    final String value = _controller.text.trim();
    // Checked here as well as server-side, because an empty string would be sent as no
    // reason at all and come back as a 400 the sheet has already closed on.
    if (value.isEmpty) {
      setState(() => _error = 'Шалтгаан заавал бөглөнө.');
      return;
    }
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Center(child: SheetHandle()),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  '${widget.status.label} болгох',
                  style: EmployeeTokens.cardTitle,
                ),
                const SizedBox(height: 12),
                const FieldLabel('Шалтгаан'),
                SheetField(
                  controller: _controller,
                  hint: 'Юунаас болж хүлээгдэж байгааг бичнэ үү.',
                  maxLines: 3,
                  error: _error,
                ),
              ],
            ),
          ),
          SheetFooter(
            busy: false,
            saveLabel: 'Хадгалах',
            onCancel: () => Navigator.of(context).pop(),
            onSave: _save,
          ),
        ],
      ),
    );
  }
}

/// The one way into the conclusion editor, and the reason when there isn't one.
///
/// THE TAP IS A WRITE, whatever the label on it says. `GET /service-requests/:id/report` is
/// `getOrCreate`: it MINTS a draft and attributes it to the caller on first read, so merely
/// arriving at [ConclusionEditorScreen] makes the person who opened it the author of a
/// conclusion on this job. Hiding the control is therefore the gate itself — a disabled
/// button would be equivalent, but a control that cannot be reached at all is the only one
/// that cannot be reached by accident. There is no read-only route that skips that GET, so
/// the view path is gated by the same three conditions rather than being let past them;
/// where a conclusion exists to be read — REPORT_SUBMITTED, VERIFICATION, COMPLETED — all
/// three hold anyway.
///
/// THREE CONDITIONS, ALL OF WHICH MUST HOLD, and the section says which one failed rather
/// than drawing nothing — the same doctrine as [_ProgressSection]:
///
///   1. The record is on screen. Assignment and arrival are both facts ABOUT the record,
///      so without one there is nothing to check them against.
///   2. The request is this employee's, or their team's — [resolveRequestAssignment], the
///      same mirror the progress buttons use, not a second id comparison. Oversight and
///      not-yet-known callers come back `unrestricted` and are not narrowed.
///   3. The technician has ARRIVED — [ServiceRequestStatus.hasArrivedOnSite]. A conclusion
///      is an account of a visit, and the visit has not happened yet.
class _ConclusionSection extends ConsumerWidget {
  const _ConclusionSection({
    required this.requestId,
    required this.requestNumber,
    required this.detail,
    required this.stillReading,
    required this.buildingId,
    required this.buildingName,
  });

  final String requestId;
  final String requestNumber;
  final ServiceRequestDetailModel? detail;

  /// The detail read is in flight and has landed nothing yet.
  final bool stillReading;

  final String? buildingId;
  final String? buildingName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ServiceRequestDetailModel? record = detail;

    if (record == null) {
      // The spinner above the fold is already saying this. A second sentence under the
      // heading, while the answer is still coming, would only be the same wait twice.
      if (stillReading) return const SizedBox.shrink();

      // A 404 or a failed read, both already explained above. What is added here is the
      // consequence: neither gate can be evaluated, so the way in is not offered.
      return const NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.yellow,
        icon: Icons.lock_outline,
        title: 'Дүгнэлт нээх боломжгүй',
        text: 'Хүсэлтийн дэлгэрэнгүй уншигдаагүй тул энэ ажил тань эсэх, очсон эсэхийг '
            'шалгах боломжгүй байна. Дахин ачаалж үзнэ үү.',
      );
    }

    final PlannedWorkAssignment assignment = resolveRequestAssignment(
      request: record,
      identity: ref.watch(workIdentityProvider).valueOrNull,
      grants: ref.watch(workGrantsProvider),
    );

    // The same two cases [_ProgressSection] names, worded for this section rather than
    // repeated verbatim: both banners are on screen at once when a technician opens
    // somebody else's job, and the same sentence printed twice under two different
    // headings reads as a rendering fault rather than as two withheld controls.
    if (assignment.blocksWrites) {
      return NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.yellow,
        icon: Icons.person_off_outlined,
        title: record.isUnclaimed
            ? 'Эхлээд ажлыг өөртөө авна уу'
            : 'Танд оногдоогүй ажлын дүгнэлт',
        text: record.isUnclaimed
            ? 'Энэ хүсэлт хэн нэгэнд хуваарилагдаагүй байна. Дүгнэлт бичихийн тулд '
                'эхлээд "Нээлттэй" жагсаалтаас өөртөө авна уу.'
            : 'Энэ хүсэлт танд ч, таны багт ч хуваарилагдаагүй тул дүгнэлтийг нь нээх '
                'боломжгүй. Дүгнэлтийг ажлыг хариуцсан ажилтан бичнэ.',
      );
    }

    final ServiceRequestStatus? status = record.status;
    if (status == null || !status.hasArrivedOnSite) {
      return NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.schedule_outlined,
        title: 'Дүгнэлт хараахан нээгдээгүй',
        text: 'Очсоны дараа дүгнэлт бичих боломжтой. Одоогийн төлөв '
            '"${status?.label ?? kNoValue}" байна — "Ажлын явц" хэсэгт "Очсон" гэж '
            'бүртгэсний дараа энэ хэсэг нээгдэнэ.',
      );
    }

    final bool canAuthor = ref.watch(conclusionGrantsProvider).canAuthor;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (!canAuthor)
          const NoticeBanner(
            margin: EdgeInsets.zero,
            tone: EmployeeTokens.muted,
            icon: Icons.lock_outline,
            title: 'Бичих эрх байхгүй',
            text: 'Танд "service_request.update" эрх байхгүй тул дүгнэлт бичих '
                'боломжгүй. Бичигдсэн дүгнэлтийг харах боломжтой.',
          )
        else
          const NoticeBanner(
            margin: EdgeInsets.zero,
            tone: EmployeeTokens.muted,
            icon: Icons.info_outline,
            text: 'Дүгнэлтийг тоноглол тус бүрээр бичнэ. Сонгосон тоноглол бүр '
                '"Үзлэг ба дүгнэлт" хэсэгт тусдаа мөр болж харагдана.',
          ),
        const SizedBox(height: 12),
        // One full-width pill per line. Never a Row child: a WorkButton has no
        // intrinsic width and cannot lay out unconstrained.
        WorkButton(
          label: canAuthor ? 'Дүгнэлт бичих' : 'Дүгнэлт харах',
          onPressed: () => Navigator.of(context).push(
            ConclusionEditorScreen.route(
              requestId: requestId,
              requestNumber: requestNumber,
              buildingId: buildingId,
              buildingName: buildingName,
            ),
          ),
        ),
      ],
    );
  }
}

/// Where a handed-in conclusion has got to — a statement, never a control.
///
/// THERE IS NO "Дүгнэлт батлах" BUTTON ON THIS APP, AND THERE MUST NOT BE ONE. Approving a
/// conclusion is an OFFICE act, performed on the web admin: it is the moment somebody other
/// than the author accepts the work, writes it into the report store and moves every named
/// piece of equipment's assessment. The field app is where the conclusion is WRITTEN, so an
/// approve control here would let the same person who wrote a conclusion sign it off from
/// the same screen — the app approving its own work — and no permission grant makes that a
/// sensible thing for a phone in a plant room to offer.
///
/// SO THIS SECTION IS NOT PERMISSION-GATED, and the absence of a gate is the point. It used
/// to branch on `service_request.approve_report`: the key drew the button, and its absence
/// drew a "Батлах эрх байхгүй" apology naming the missing permission. Both branches are
/// gone. A holder of `service_request.approve_report` — or of the office's whole
/// `service_request.change_status` — sees exactly what a technician sees, because the
/// button's absence is a decision about WHERE approval happens and not about who may do it.
/// `POST /service-requests/:id/report/approve` still exists and the web admin still calls
/// it; this app simply no longer has a client for it.
///
/// WHAT IS LEFT IS ONE NEUTRAL SENTENCE, off the REQUEST'S own status rather than the
/// conclusion's, and that read is deliberate rather than approximate. Reading the conclusion
/// is `GET /service-requests/:id/report`, which is `getOrCreate`: it MINTS a draft attributed
/// to the caller on first read, so fetching it here to discover whether it is SUBMITTED
/// would make every technician who merely opened a request the author of an empty conclusion
/// on it — the same reason the editor sits behind an explicit tap. REPORT_SUBMITTED on the
/// request is that same fact, carried by a read that has already happened.
///
/// Shown to everyone who can see the request, assigned or not: nothing is written from here,
/// so there is nothing to withhold from a colleague or from a reader of the open pool. It is
/// simply what has happened to this job.
class _ApprovalSection extends StatelessWidget {
  const _ApprovalSection({required this.detail});

  final ServiceRequestDetailModel? detail;

  @override
  Widget build(BuildContext context) {
    final ServiceRequestDetailModel? record = detail;
    // Nothing to say unless a conclusion has actually been handed in. On every other status
    // this is not a quieter notice, it is no notice: "waiting for the office" printed on a
    // job nobody has written up yet is noise.
    if (record == null || record.status != ServiceRequestStatus.reportSubmitted) {
      return const SizedBox.shrink();
    }

    return const Padding(
      padding: EdgeInsets.only(top: 12),
      child: NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.schedule_outlined,
        title: 'Дүгнэлт хянуулахаар илгээгдсэн',
        text: 'Дүгнэлт илгээгдсэн бөгөөд оффис хянаж батална. Батлах, буцаах хоёрыг '
            'аль алиныг нь оффис хийх тул энэ аппаас гүйцэтгэхгүй.',
      ),
    );
  }
}

/// What the request is and where — from the record once it lands, from the row that
/// opened the screen until then.
///
/// Every value falls back rather than disappearing, so nothing on this card moves when
/// the read settles; it only becomes more specific.
class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.detail,
    required this.subject,
    required this.location,
    required this.statusLabel,
    required this.slaLabel,
  });

  final ServiceRequestDetailModel? detail;
  final String subject;
  final String location;
  final String? statusLabel;
  final String? slaLabel;

  @override
  Widget build(BuildContext context) {
    final ServiceRequestDetailModel? record = detail;

    final String title = record?.subjectLabel ?? subject;
    final String resolved = record?.locationLabel ?? '';
    final String where = resolved.isNotEmpty
        ? resolved
        : (location.isEmpty ? kNoValue : location);
    final String? status = record?.status?.label ?? statusLabel;
    final String sla = record != null
        ? formatSlaRemaining(record.slaRemainingMinutes)
        : (slaLabel ?? kNoValue);
    final bool urgent = record?.isUrgent ?? false;

    return WorkCard(
      margin: EdgeInsets.zero,
      accent: urgent ? EmployeeTokens.red : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(title, style: EmployeeTokens.cardTitle),
          if (urgent) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              'Яаралтай',
              style:
                  EmployeeTokens.pillLabel.copyWith(color: EmployeeTokens.red),
            ),
          ],
          const SizedBox(height: 8),
          InfoRow(label: 'Байршил', value: where),
          if (record?.requestType != null)
            InfoRow(label: 'Төрөл', value: record!.requestType!.label),
          if (record?.branch != null)
            InfoRow(label: 'Салбар', value: record!.branch!),
          if (status != null)
            InfoRow(
              label: 'Төлөв',
              value: status,
              tone: _toneOf(record?.status?.band),
            ),
          if (record != null && record.assignedEmployees.isNotEmpty)
            InfoRow(
              label: 'Хариуцагч',
              value: record.assignedEmployees
                  .map((NamedRef employee) => employee.name)
                  .join(', '),
            ),
          if (record?.assignedTeam != null)
            InfoRow(label: 'Баг', value: record!.assignedTeam!.name),
          if (record?.createdAt != null)
            InfoRow(label: 'Үүссэн', value: formatDateTime(record!.createdAt)),
          InfoRow(label: 'SLA', value: sla, divider: false),
        ],
      ),
    );
  }

  /// The domain's severity band as this tab's status colour. `neutral` and an unknown
  /// band both read as ink, because colour means risk on this screen and nothing else.
  static Color _toneOf(SeverityBand? band) {
    switch (band) {
      case SeverityBand.red:
        return EmployeeTokens.red;
      case SeverityBand.yellow:
        return EmployeeTokens.yellow;
      case SeverityBand.green:
        return EmployeeTokens.green;
      case SeverityBand.ink:
      case SeverityBand.neutral:
      case null:
        return EmployeeTokens.ink;
    }
  }
}

/// The site contact's number, selectable so it can be copied out of the app.
class _PhoneRow extends StatelessWidget {
  const _PhoneRow({required this.phone});

  final String phone;

  @override
  Widget build(BuildContext context) {
    if (phone.isEmpty) {
      return const InfoRow(label: 'Утас', value: kNoValue, divider: false);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            flex: 4,
            child: Text(
              'Утас',
              style:
                  EmployeeTokens.rowSub.copyWith(fontWeight: FontWeight.w500),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 6,
            child: SelectableText(
              phone,
              textAlign: TextAlign.right,
              style: EmployeeTokens.detailValue,
            ),
          ),
        ],
      ),
    );
  }
}

/// The read is in flight and there is nothing behind it yet.
class _LoadingNotice extends StatelessWidget {
  const _LoadingNotice();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        const SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        const SizedBox(width: 10),
        Text('Дэлгэрэнгүйг уншиж байна…', style: EmployeeTokens.rowSub),
      ],
    );
  }
}
