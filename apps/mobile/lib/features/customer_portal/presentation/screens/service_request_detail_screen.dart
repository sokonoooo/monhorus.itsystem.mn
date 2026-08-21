import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/service_request_model.dart';
import '../../data/models/survey_model.dart';
import '../../domain/entities/risk_level.dart';
import '../../domain/entities/service_request_enums.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/risk_widgets.dart';
import '../widgets/survey_sheet.dart';
import 'customer_shell_screen.dart';

/// Which part of the request the screen is showing.
///
/// [progress] is everything the screen carried before the conclusion existed — the
/// location trail and the status timeline. [report] is the technician's approved
/// conclusion, which is a different document about the same request rather than one
/// more section of it, and is fetched separately. [survey] is the customer's own turn
/// to speak, and unlike the other two it is CONDITIONAL: it appears only while there
/// is somebody left to rate.
///
/// Because it is conditional, the tab strip's index is no longer this enum's index.
/// See the `visibleTabs` list in the build method: `_RequestTab.values[index]` would
/// have selected the wrong tab the moment the survey one was absent.
enum _RequestTab { progress, report, survey }

/// s-request-detail: one request, its SLA, its location trail and its progress, plus
/// the technician's conclusion once the office has approved one.
class ServiceRequestDetailScreen extends ConsumerStatefulWidget {
  const ServiceRequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  ConsumerState<ServiceRequestDetailScreen> createState() =>
      _ServiceRequestDetailScreenState();
}

class _ServiceRequestDetailScreenState
    extends ConsumerState<ServiceRequestDetailScreen> {
  _RequestTab _tab = _RequestTab.progress;

  /// The survey this request is still waiting on, or null when there is none.
  ///
  /// Read off [pendingSurveysProvider] rather than by asking for the form. Watching
  /// [surveyFormProvider] is what issues `GET /surveys/requests/:id/form`, and that
  /// endpoint 404s for every request with nothing to rate — which is most of them —
  /// so the pending list, which the home screen loads anyway, is what decides whether
  /// the tab exists. The same rule the report tab follows with `hasApprovedReport`:
  /// do not fire a request already known to fail.
  SurveyPendingItemModel? _pendingSurvey() {
    if (!ref.watch(canSubmitSurveyProvider)) return null;

    final List<SurveyPendingItemModel>? pending =
        ref.watch(pendingSurveysProvider).valueOrNull;
    if (pending == null) return null;

    for (final SurveyPendingItemModel item in pending) {
      if (item.serviceRequestId == widget.requestId && item.hasOutstanding) {
        return item;
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<ServiceRequestDetailModel> request =
        ref.watch(serviceRequestDetailProvider(widget.requestId));
    final SurveyPendingItemModel? survey = _pendingSurvey();

    // The strip's index is an index into THIS list, never into `_RequestTab.values`.
    // The survey tab comes and goes, so the two stopped agreeing the moment it was
    // added: with the survey absent, `values[1]` is report — correct by luck — but any
    // further conditional tab would have selected a neighbour instead.
    final List<_RequestTab> visibleTabs = <_RequestTab>[
      _RequestTab.progress,
      _RequestTab.report,
      if (survey != null) _RequestTab.survey,
    ];

    // The survey tab can vanish under the customer — they answer the last technician
    // and the list refreshes — so the selection is resolved against what is on screen
    // rather than trusted. Falling back rather than clamping: the first tab is the one
    // that always exists.
    final _RequestTab tab =
        visibleTabs.contains(_tab) ? _tab : _RequestTab.progress;

    return CustomerScaffold(
      navBar: CustomerNavBar(
        title: request.valueOrNull?.requestNumber ?? 'Хүсэлт',
        subtitle: switch (tab) {
          _RequestTab.progress => 'Хүсэлтийн явц',
          _RequestTab.report => 'Техникчийн дүгнэлт',
          _RequestTab.survey => 'Үйлчилгээний үнэлгээ',
        },
      ),
      // The tabs sit outside [CustomerAsyncView], as the floor screen puts them, so
      // they stay tappable while the request is still in flight or has failed.
      body: Column(
        children: <Widget>[
          TabRow(
            labels: <String>[
              for (final _RequestTab visible in visibleTabs)
                switch (visible) {
                  _RequestTab.progress => 'Хүсэлтийн явц',
                  _RequestTab.report => 'Тайлан',
                  _RequestTab.survey => 'Үнэлгээ',
                },
            ],
            selectedIndex: visibleTabs.indexOf(tab),
            onSelected: (int index) =>
                setState(() => _tab = visibleTabs[index]),
          ),
          Expanded(
            child: CustomerAsyncView<ServiceRequestDetailModel>(
              value: request,
              onRetry: () =>
                  ref.invalidate(serviceRequestDetailProvider(widget.requestId)),
              builder: (BuildContext ctx, ServiceRequestDetailModel data) =>
                  _body(ctx, data, tab, survey),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    ServiceRequestDetailModel request,
    _RequestTab tab,
    SurveyPendingItemModel? survey,
  ) {
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(serviceRequestDetailProvider(widget.requestId))
          ..invalidate(customerWorkReportProvider(widget.requestId))
          ..invalidate(pendingSurveysProvider);
      },
      child: ListView(
        padding: const EdgeInsets.only(top: 8, bottom: 24),
        children: <Widget>[
          if (request.locationPath.isNotEmpty)
            Breadcrumb(
              parts: request.locationPath
                  .map((ObjectBreadcrumbModel node) => node.name)
                  .toList(growable: false),
            ),
          switch (tab) {
            _RequestTab.progress => _ProgressTab(request: request),
            _RequestTab.report => _ReportTab(
                requestId: widget.requestId,
                hasApprovedReport: request.hasApprovedReport,
              ),
            // Non-null whenever this tab is reachable: it is in `visibleTabs` only
            // when the pending list named this request.
            _RequestTab.survey => _SurveyTab(
                requestId: widget.requestId,
                pending: survey!,
              ),
          },
        ],
      ),
    );
  }
}

/// The "Хүсэлтийн явц" tab: everything this screen showed before the report existed.
class _ProgressTab extends StatelessWidget {
  const _ProgressTab({required this.request});

  final ServiceRequestDetailModel request;

  @override
  Widget build(BuildContext context) {
    final ServiceRequestStatus? status = request.status;
    // The stage first on the header, for the same reason a list row prefers it: this
    // block reports where the work has got to, and that is the board's word for it.
    // The status label is the fallback and carries a one-to-one rename of its own, and
    // `ink` remains the last resort for a status this binary cannot name at all.
    final Color stepColour = request.stage?.tone?.foreground ??
        status?.tone.foreground ??
        CustomerTokens.ink;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        PanelCard(
          accent: request.isUrgent
              ? CustomerTokens.red
              : stepColour,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          <String>[
                            request.requestNumber,
                            if (request.device != null) request.device!.name,
                          ].join(' · '),
                          style: CustomerTokens.monoLabel.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          request.description,
                          style: CustomerTokens.cardTitle.copyWith(height: 1.35),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (request.isUrgent)
                    const StatusPill(
                      label: 'Яаралтай',
                      tone: AccentTone.red,
                      showDot: true,
                    ),
                ],
              ),
              const SizedBox(height: 12),
              MetricGrid(
                padded: false,
                cards: <Widget>[
                  MetricCard(
                    label: 'Төлөв',
                    value: request.stepLabel ?? '-',
                    note: request.assigneeLine,
                    valueColor: stepColour,
                  ),
                ],
              ),
              // Absent for a cancelled request, and for any status off the linear
              // workflow: see [ServiceRequestStatus.progress]. A part-full rail on
              // work that was called off is a completion figure nobody stated.
              if (status?.progress case final double fraction) ...<Widget>[
                const SizedBox(height: 10),
                ProgressRail(
                  fraction: fraction,
                  color: request.isUrgent
                      ? CustomerTokens.red
                      : stepColour,
                ),
              ],
            ],
          ),
        ),

        const SectionCaption('Байршил ба холбоо барих'),
        PanelCard(
          padding: EdgeInsets.zero,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (request.customer != null)
                _InfoRow('Байгууллага', request.customer!.name),
              if (request.branch != null) _InfoRow('Салбар', request.branch!),
              if (request.project != null)
                _InfoRow('Төсөл', request.project!.name),
              if (request.building != null)
                _InfoRow('Барилга', request.building!.name),
              if (request.floor != null) _InfoRow('Давхар', request.floor!.name),
              if (request.room != null) _InfoRow('Өрөө', request.room!.name),
              if (request.panel != null) _InfoRow('Самбар', request.panel!.name),
              if (request.circuit != null)
                _InfoRow('Хэлхээ', request.circuit!.name),
              if (request.device != null)
                _InfoRow('Төхөөрөмж', request.device!.name),
              _InfoRow('Холбоо барих', request.contactName),
              _InfoRow('Утас', request.contactPhone),
              _InfoRow('Үүсгэсэн', formatDateTime(request.createdAt)),
              if (request.createdByName != null)
                _InfoRow('Үүсгэсэн хүн', request.createdByName!),
              if (request.revisitReason != null)
                _InfoRow('Дахин очих шалтгаан', request.revisitReason!),
              if (request.slaExtensionReason != null)
                _InfoRow('SLA сунгасан шалтгаан', request.slaExtensionReason!),
              _InfoRow('Сүүлд шинэчилсэн', formatDateTime(request.updatedAt)),
            ],
          ),
        ),

        if (request.attachments.isNotEmpty) ...<Widget>[
          const SectionCaption('Хавсралт'),
          for (final ServiceRequestAttachmentModel attachment
              in request.attachments)
            _AttachmentCard(attachment: attachment),
        ],

        const SectionCaption('Үйл явц'),
        if (request.statusHistory.isEmpty)
          const CustomerEmptyState(
            icon: Icons.timeline_outlined,
            message: 'Төлөвийн түүх бүртгэгдээгүй байна.',
          )
        else
          Timeline(
            entries: <TimelineEntry>[
              for (int i = 0; i < request.statusHistory.length; i++)
                TimelineEntry(
                  title: _historyTitle(request.statusHistory[i]),
                  meta: <String>[
                    formatEventStamp(request.statusHistory[i].changedAt),
                    if (request.statusHistory[i].changedByName != null)
                      request.statusHistory[i].changedByName!,
                    if (request.statusHistory[i].reason != null)
                      request.statusHistory[i].reason!,
                  ].join(' · '),
                  tone: request.statusHistory[i].toStatus?.tone ??
                      AccentTone.neutral,
                  icon: Icons.circle_outlined,
                  isLast: i == request.statusHistory.length - 1,
                ),
            ],
          ),
      ],
    );
  }

  static String _historyTitle(ServiceRequestStatusHistoryModel entry) {
    final String to = entry.toStatus?.label ?? '-';
    final ServiceRequestStatus? from = entry.fromStatus;
    return from == null ? '$to төлөвт бүртгэгдсэн' : '${from.label} → $to';
  }
}

/// The "Тайлан" tab: the technician's conclusion, once the office has approved one.
///
/// [hasApprovedReport] is read BEFORE [customerWorkReportProvider] is watched, and
/// that ordering is the point of the flag. Watching the provider is what issues
/// `GET /:requestId/report/customer`, and that endpoint answers 404 for every request
/// without an approved conclusion — which is most of them — so a request that has no
/// report makes no call at all rather than one that is certain to fail.
class _ReportTab extends ConsumerWidget {
  const _ReportTab({required this.requestId, required this.hasApprovedReport});

  final String requestId;
  final bool hasApprovedReport;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!hasApprovedReport) return const _ReportNotReady();

    return CustomerAsyncView<CustomerWorkReportModel?>(
      value: ref.watch(customerWorkReportProvider(requestId)),
      onRetry: () => ref.invalidate(customerWorkReportProvider(requestId)),
      // Null means the endpoint 404'd after the detail said there was a report: the
      // conclusion was un-approved between the two reads, or the two raced. Nothing
      // has gone wrong for the customer, so it reads as not-ready rather than as a
      // failure.
      builder: (BuildContext ctx, CustomerWorkReportModel? report) =>
          report == null ? const _ReportNotReady() : _ReportBody(report: report),
    );
  }
}

/// What the tab says while there is no approved conclusion to show.
///
/// Stated as a stage of the work rather than as an absence, because it is one: the
/// technician finishes, the office approves, and only then is there anything here.
class _ReportNotReady extends StatelessWidget {
  const _ReportNotReady();

  @override
  Widget build(BuildContext context) {
    return const CustomerEmptyState(
      icon: Icons.assignment_outlined,
      message: 'Техникчийн дүгнэлт хараахан бэлэн болоогүй байна. Ажил дуусаж, '
          'дүгнэлт баталгаажсаны дараа энд харагдана.',
    );
  }
}

class _ReportBody extends StatelessWidget {
  const _ReportBody({required this.report});

  final CustomerWorkReportModel report;

  @override
  Widget build(BuildContext context) {
    final bool hasText = report.conclusion != null || report.recommendation != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // The same ring the device screen prints an assessment with, fed the report's
        // own score and the band the server derived for it. A missing score renders as
        // a dash, never as a zero.
        ScoreCircleCard(
          score: report.score,
          level: report.riskLevel,
          title: report.riskLevel?.label ?? unassessedLabel,
          body: report.score == null
              ? 'Энэ ажилд тоон үнэлгээ бүртгэгдээгүй байна.'
              : 'Ажил дууссаны дараа техникчийн өгсөн үнэлгээ.',
        ),

        const SectionCaption('Дүгнэлт ба зөвлөмж'),
        PanelCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (report.conclusion != null) ...<Widget>[
                const FieldLabel('Дүгнэлт'),
                Text(
                  report.conclusion!,
                  style: CustomerTokens.body.copyWith(color: CustomerTokens.ink),
                ),
                const SizedBox(height: 12),
              ],
              if (report.recommendation != null) ...<Widget>[
                const FieldLabel('Зөвлөмж'),
                Text(
                  report.recommendation!,
                  style: CustomerTokens.body.copyWith(color: CustomerTokens.ink),
                ),
                const SizedBox(height: 12),
              ],
              if (!hasText) ...<Widget>[
                Text(
                  'Бичгэн тайлбар үлдээгээгүй байна.',
                  style: CustomerTokens.rowSub,
                ),
                const SizedBox(height: 12),
              ],
              Wrap(
                spacing: 7,
                runSpacing: 5,
                children: <Widget>[
                  if (report.repairRequired)
                    const StatusPill(
                      label: 'Засвар шаардлагатай',
                      tone: AccentTone.red,
                    ),
                  if (report.revisitRequired)
                    const StatusPill(label: 'Дахин үзлэг', tone: AccentTone.yellow),
                  if (report.revisitDate != null)
                    StatusPill(
                      label: 'Дахин очих ${formatDate(report.revisitDate)}',
                      tone: AccentTone.neutral,
                    ),
                  // Said out loud rather than left as an empty row: "no further work"
                  // is a result, and a blank space does not report it.
                  if (!report.repairRequired && !report.revisitRequired)
                    const StatusPill(
                      label: 'Нэмэлт ажил шаардлагагүй',
                      tone: AccentTone.green,
                    ),
                ],
              ),
            ],
          ),
        ),

        const SectionCaption('Баталгаажуулалт'),
        PanelCard(
          padding: EdgeInsets.zero,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _InfoRow('Баталсан хүн', report.approvedByName ?? '-'),
              _InfoRow('Батлагдсан', formatDateTime(report.approvedAt)),
            ],
          ),
        ),

        // Labelled separately, and never merged: which picture is the fault and which
        // is the repair is the whole point of keeping two sets.
        if (report.beforePhotos.isNotEmpty) ...<Widget>[
          const SectionCaption('Ажлын өмнөх зураг'),
          for (final WorkReportPhotoModel photo in report.beforePhotos)
            _AttachmentCard(attachment: photo),
        ],
        if (report.afterPhotos.isNotEmpty) ...<Widget>[
          const SectionCaption('Ажлын дараах зураг'),
          for (final WorkReportPhotoModel photo in report.afterPhotos)
            _AttachmentCard(attachment: photo),
        ],
      ],
    );
  }
}

/// The "Үнэлгээ" tab: the customer's own turn to speak about this job.
///
/// Only ever built when [pendingSurveysProvider] named this request, so it opens no
/// request of its own and states nothing it has not been told. Every technician on the
/// job is listed with their standing — answered, skipped, or still waiting — because a
/// survey answered per person is not a form with a progress bar; it is several
/// statements about several people, and the customer should see which they have made.
///
/// Nothing here prints a duration, a deadline or a response window. The customer
/// surfaces of this app carry no SLA, and a satisfaction question is not the place to
/// introduce one.
class _SurveyTab extends StatelessWidget {
  const _SurveyTab({required this.requestId, required this.pending});

  final String requestId;
  final SurveyPendingItemModel pending;

  @override
  Widget build(BuildContext context) {
    final int outstanding = pending.outstandingEmployees.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        PanelCard(
          accent: CustomerTokens.accent,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                'Ажил дууслаа. Үнэлгээ өгөөрэй.',
                style: CustomerTokens.cardTitle.copyWith(height: 1.3),
              ),
              const SizedBox(height: 8),
              Text(
                'Энэ дуудлагад ажилласан $outstanding ажилтныг тус тусад нь '
                'үнэлнэ. Уулзаагүй ажилтныг үнэлэх шаардлагагүй.',
                style: CustomerTokens.body.copyWith(height: 1.6),
              ),
              const SizedBox(height: 14),
              FilledButton(
                onPressed: () => unawaited(
                  SurveySheet.show(context, requestId: requestId),
                ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
                child: const Text('Үнэлгээ өгөх'),
              ),
            ],
          ),
        ),

        const SectionCaption('Ажилласан ажилтан'),
        PanelCard(
          padding: EdgeInsets.zero,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (final SurveyPendingEmployeeModel entry in pending.employees)
                DetailRow(
                  label: entry.employee.displayName,
                  value: switch (entry) {
                    SurveyPendingEmployeeModel(isRated: true) => 'Үнэлсэн',
                    SurveyPendingEmployeeModel(isSkipped: true) =>
                      'Харилцаагүй',
                    _ => 'Хүлээгдэж байна',
                  },
                  labelWidth: 150,
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// One label / value line in the location card, forwarded to [DetailRow].
class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) =>
      DetailRow(label: label, value: value, labelWidth: 118);
}

class _AttachmentCard extends StatelessWidget {
  const _AttachmentCard({required this.attachment});

  final ServiceRequestAttachmentModel attachment;

  @override
  Widget build(BuildContext context) {
    return PanelCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (attachment.isImage)
            AuthenticatedImage(fileId: attachment.id, height: 180),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: <Widget>[
                Icon(
                  attachment.isImage
                      ? Icons.image_outlined
                      : Icons.description_outlined,
                  size: 18,
                  color: CustomerTokens.muted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        attachment.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: CustomerTokens.rowTitle.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        <String>[
                          formatBytes(attachment.sizeBytes),
                          if (attachment.uploadedByName != null)
                            attachment.uploadedByName!,
                          formatDate(attachment.uploadedAt),
                        ].join(' · '),
                        style: CustomerTokens.rowSub,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
