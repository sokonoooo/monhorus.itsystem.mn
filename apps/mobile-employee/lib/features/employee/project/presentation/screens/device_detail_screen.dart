import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../domain/entities/object_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/assessment_sheet.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import '../widgets/report_sheet.dart';

/// `s-device-detail` — level 5: one device.
///
/// Carries what the prototype's device screen carries and the API actually holds:
/// code, name, type, location, status, үнэлгээ, тэмдэглэл, зураг and the full report
/// history. The prototype's "Дүгнэлт тайлан бичих" is discussed in [_AssessNotice].
class DeviceDetailScreen extends ConsumerWidget {
  const DeviceDetailScreen({
    super.key,
    required this.objectId,
    required this.fallbackTitle,
    required this.fallbackSubtitle,
    required this.floorName,
    required this.buildingName,
    required this.projectName,
  });

  final String objectId;

  /// Painted in the header until the detail request settles, so the screen does not
  /// open on an empty title bar.
  final String fallbackTitle;
  final String fallbackSubtitle;

  final String floorName;
  final String buildingName;
  final String projectName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ObjectDetailModel> device =
        ref.watch(objectDetailProvider(objectId));
    final ObjectDetailModel? current = device.valueOrNull;

    return ProjectScaffold(
      navBar: ProjectNavBar(
        title: current == null
            ? fallbackTitle
            : (current.code.isEmpty ? current.name : current.code),
        subtitle: current?.name ?? fallbackSubtitle,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(objectDetailProvider(objectId))
            ..invalidate(objectHistoryProvider(objectId));
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 28),
          children: <Widget>[
            Breadcrumb(
              parts: <String>[
                buildingName,
                floorName,
                current == null
                    ? fallbackTitle
                    : (current.code.isEmpty ? current.name : current.code),
              ],
            ),
            ProjectAsyncView<ObjectDetailModel>(
              value: device,
              onRetry: () => ref.invalidate(objectDetailProvider(objectId)),
              loading: const ProjectLoading(height: 180),
              builder: (BuildContext ctx, ObjectDetailModel data) =>
                  _DeviceBody(device: data),
            ),
            const SectionHeading('Тайлангийн бүх түүх'),
            _HistorySection(objectId: objectId, deviceLabel: fallbackTitle),
          ],
        ),
      ),
    );
  }
}

class _DeviceBody extends StatelessWidget {
  const _DeviceBody({required this.device});

  final ObjectDetailModel device;

  @override
  Widget build(BuildContext context) {
    final LatestAssessmentModel? latest = device.latestAssessment;
    final RiskLevel? band = latest?.riskLevel;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // The alert banner appears only for a band the backend itself flags as
        // critical, and it prints the үнэлгээ's own conclusion rather than a
        // sentence this app invented about the device.
        if (band != null && band.isCritical)
          NoticeBanner.alert(
            title: band.label,
            text: latest?.conclusion?.isNotEmpty == true
                ? latest!.conclusion!
                : 'Сүүлийн үнэлгээгээр ноцтой эрсдэлтэй тэмдэглэгдсэн. Яаралтай '
                    'үзлэг шаардлагатай.',
          ),

        ProjectCard(
          accent: band?.tone.foreground ?? EmployeeTokens.line,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: <Widget>[
                  ScoreRing(score: device.score, level: band),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          device.code.isEmpty ? device.name : device.code,
                          style: EmployeeTokens.headerTitle,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          device.name,
                          style: EmployeeTokens.rowSub,
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 5,
                          runSpacing: 5,
                          children: <Widget>[
                            EmployeePill(
                              label: band?.label ?? unassessedLabel,
                              tone: riskTone(band),
                              showGlyph: true,
                              glyphLevel: band,
                              semanticLabel: riskSemanticLabel(band),
                            ),
                            if (device.status != null)
                              EmployeePill(
                                label: device.status!.label,
                                tone: device.status!.tone,
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),

        const SectionHeading('Төхөөрөмжийн мэдээлэл', topPadding: 4),
        ProjectCard(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              DetailRow(label: 'Код', value: device.code, mono: true),
              DetailRow(label: 'Нэр', value: device.name),
              DetailRow(
                label: 'Төрөл',
                value: device.typeName.isEmpty ? '—' : device.typeName,
              ),
              DetailRow(
                label: 'Ангилал',
                value: device.category?.label ?? '—',
              ),
              DetailRow(
                label: 'Байршил',
                value: device.locationLine ?? '—',
              ),
              DetailRow(
                label: 'Төлөв',
                value: device.status?.label ?? '—',
                valueColor: device.status?.tone.foreground ?? EmployeeTokens.ink,
              ),
              DetailRow(
                label: 'Сүүлийн үзлэг',
                value: formatDate(device.latestAssessment?.assessedAt),
                mono: true,
                isLast: true,
              ),
            ],
          ),
        ),

        _LoadCard(device: device),
        _AttributeCard(device: device),

        if (device.notes != null && device.notes!.isNotEmpty) ...<Widget>[
          const SectionHeading('Тэмдэглэл', topPadding: 4),
          NoticeBanner.neutral(text: device.notes!),
        ],
        if (device.description != null && device.description!.isNotEmpty) ...<Widget>[
          const SectionHeading('Тайлбар', topPadding: 4),
          NoticeBanner.neutral(text: device.description!),
        ],

        if (latest?.recommendation != null &&
            latest!.recommendation!.isNotEmpty) ...<Widget>[
          const SectionHeading('Зөвлөмж', topPadding: 4),
          NoticeBanner.info(text: latest.recommendation!),
        ],

        const SectionHeading('Зураг', topPadding: 4),
        _PhotoSection(photos: device.photos),

        _AssessAction(device: device),
      ],
    );
  }
}

/// The section 11.5 load figures.
///
/// An incomplete calculation is printed as "Бүрэн бус" with the backend's own
/// reasons, never as a zero: on an electrical report a missing input and a genuine
/// zero reading are different facts.
class _LoadCard extends StatelessWidget {
  const _LoadCard({required this.device});

  final ObjectDetailModel device;

  @override
  Widget build(BuildContext context) {
    final LoadValueModel calculated = device.calculatedLoad;
    final LoadValueModel percent = device.loadPercent;

    if (!calculated.hasValue &&
        device.measuredLoadKw == null &&
        !percent.hasValue) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SectionHeading('Ачаалал', topPadding: 4),
        MetricGrid(
          cards: <Widget>[
            MetricCard(
              label: 'Тооцоолсон',
              value: calculated.hasValue
                  ? '${formatDecimal(calculated.valueKw)} kW'
                  : loadIncompleteLabel,
              note: calculated.hasValue
                  ? 'Section 11.5'
                  : (calculated.reasonLine.isEmpty
                      ? 'Мэдээлэл дутуу'
                      : calculated.reasonLine),
              valueColor: calculated.hasValue
                  ? EmployeeTokens.ink
                  : EmployeeTokens.muted,
            ),
            MetricCard(
              label: 'Хэмжсэн',
              value: device.measuredLoadKw == null
                  ? '—'
                  : '${formatDecimal(device.measuredLoadKw)} kW',
              note: device.measuredLoadKw == null ? 'Хэмжилт алга' : 'Талбайн хэмжилт',
            ),
            MetricCard(
              label: 'Ачааллын хувь',
              value: percent.hasValue ? '${formatDecimal(percent.valueKw)}%' : '—',
              note: percent.hasValue ? 'Хүчин чадлын харьцаа' : loadIncompleteLabel,
              valueColor: percent.hasValue && (percent.valueKw ?? 0) > 100
                  ? EmployeeTokens.red
                  : EmployeeTokens.ink,
            ),
            MetricCard(
              label: 'Нөөц',
              value: device.reserveKw.hasValue
                  ? '${formatDecimal(device.reserveKw.valueKw)} kW'
                  : '—',
              note: device.reserveKw.hasValue ? 'Үлдсэн чадал' : loadIncompleteLabel,
            ),
          ],
        ),
      ],
    );
  }
}

/// The category-specific block: only one of panel / circuit / equipment is ever set.
class _AttributeCard extends StatelessWidget {
  const _AttributeCard({required this.device});

  final ObjectDetailModel device;

  @override
  Widget build(BuildContext context) {
    final List<DetailRow> rows = <DetailRow>[];

    final PanelAttributesModel? panel = device.panel;
    if (panel != null) {
      if (panel.capacityKw != null) {
        rows.add(
          DetailRow(
            label: 'Хүчин чадал',
            value: '${formatDecimal(panel.capacityKw)} kW',
            mono: true,
          ),
        );
      }
      if (panel.protection != null && panel.protection!.isNotEmpty) {
        rows.add(DetailRow(label: 'Хамгаалалт', value: panel.protection!));
      }
    }

    final CircuitAttributesModel? circuit = device.circuit;
    if (circuit != null) {
      if (circuit.panel != null) {
        rows.add(DetailRow(label: 'Самбар', value: circuit.panel!.label));
      }
      if (circuit.breakerRating != null && circuit.breakerRating!.isNotEmpty) {
        rows.add(
          DetailRow(label: 'Таслуур', value: circuit.breakerRating!, mono: true),
        );
      }
      if (circuit.cableType != null && circuit.cableType!.isNotEmpty) {
        rows.add(DetailRow(label: 'Кабель', value: circuit.cableType!));
      }
      if (circuit.cableSectionMm2 != null) {
        rows.add(
          DetailRow(
            label: 'Огтлол',
            value: '${formatDecimal(circuit.cableSectionMm2)} мм²',
            mono: true,
          ),
        );
      }
      if (circuit.cableLengthM != null) {
        rows.add(
          DetailRow(
            label: 'Урт',
            value: '${formatDecimal(circuit.cableLengthM)} м',
            mono: true,
          ),
        );
      }
    }

    final EquipmentAttributesModel? equipment = device.equipment;
    if (equipment != null) {
      if (equipment.circuit != null) {
        rows.add(DetailRow(label: 'Хэлхээ', value: equipment.circuit!.label));
      }
      if (equipment.ratedPowerKw != null) {
        rows.add(
          DetailRow(
            label: 'Нэрлэсэн чадал',
            value: '${formatDecimal(equipment.ratedPowerKw)} kW',
            mono: true,
          ),
        );
      }
      if (equipment.quantity != null) {
        rows.add(
          DetailRow(label: 'Тоо ширхэг', value: '${equipment.quantity}', mono: true),
        );
      }
      if (equipment.installedAt != null) {
        rows.add(
          DetailRow(
            label: 'Суурилуулсан',
            value: formatDate(equipment.installedAt),
            mono: true,
          ),
        );
      }
      if (equipment.warrantyUntil != null) {
        final bool expired = equipment.warrantyUntil!.isBefore(DateTime.now());
        rows.add(
          DetailRow(
            label: 'Баталгаат хугацаа',
            value: formatDate(equipment.warrantyUntil),
            mono: true,
            valueColor: expired ? EmployeeTokens.red : EmployeeTokens.ink,
          ),
        );
      }
    }

    if (rows.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SectionHeading('Техникийн үзүүлэлт', topPadding: 4),
        ProjectCard(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (int i = 0; i < rows.length; i++)
                if (i == rows.length - 1)
                  DetailRow(
                    label: rows[i].label,
                    value: rows[i].value,
                    valueColor: rows[i].valueColor,
                    mono: rows[i].mono,
                    isLast: true,
                  )
                else
                  rows[i],
            ],
          ),
        ),
      ],
    );
  }
}

/// The object's own picture set.
///
/// Deliberately not the assessment evidence. `recordAssessment` files a photo against
/// the ASSESSMENT, never against `object.photos` — no route in the API appends to
/// that array — so a picture taken through "Дүгнэлт тайлан бичих" appears on its
/// report in the history below, not here. The empty state says so, because otherwise
/// a technician who has just photographed the device would reasonably expect to find
/// it in this strip.
class _PhotoSection extends StatelessWidget {
  const _PhotoSection({required this.photos});

  final List<ObjectPhotoModel> photos;

  @override
  Widget build(BuildContext context) {
    final List<ObjectPhotoModel> images =
        photos.where((ObjectPhotoModel photo) => photo.isImage).toList();

    if (images.isEmpty) {
      return const ProjectEmptyState(
        icon: Icons.photo_camera_outlined,
        message: 'Энэ төхөөрөмжид зураг хавсаргаагүй байна. Дүгнэлтэд хавсаргасан '
            'зураг доорх тайлангийн түүхэд харагдана.',
      );
    }

    return SizedBox(
      height: 170,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
          EmployeeTokens.gutter,
          0,
          EmployeeTokens.gutter,
          10,
        ),
        itemCount: images.length,
        separatorBuilder: (BuildContext _, int __) => const SizedBox(width: 8),
        itemBuilder: (BuildContext _, int index) {
          final ObjectPhotoModel photo = images[index];
          return ClipRRect(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
            child: Container(
              width: 200,
              decoration: BoxDecoration(
                color: EmployeeTokens.white,
                border: Border.all(
                  color: EmployeeTokens.line,
                  width: EmployeeTokens.hairline,
                ),
                borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              ),
              child: AuthenticatedImage(fileId: photo.id, fit: BoxFit.cover),
            ),
          );
        },
      ),
    );
  }
}

/// The prototype's "Дүгнэлт тайлан бичих".
///
/// Drawn only when both gates hold: the caller's effective permission set contains
/// `object_master.assess`, and the object's TYPE is configured to generate a
/// conclusion (`canAssess` on the record — `generatesConclusion` server-side). The
/// second is not a permission problem and reads differently, so a technician who
/// holds the right on a device that simply is not assessed is told which of the two
/// it is rather than finding a button that 400s.
///
/// The sheet behind it uploads its evidence to `POST /files/object-assessment-photos`
/// first, because `createObjectAssessmentSchema` refuses an assessment with an empty
/// `photoIds`.
class _AssessAction extends ConsumerWidget {
  const _AssessAction({required this.device});

  final ObjectDetailModel device;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(canAssessDevicesProvider)) return const SizedBox.shrink();

    if (!device.canAssess) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(
          EmployeeTokens.labelGutter,
          6,
          EmployeeTokens.labelGutter,
          0,
        ),
        child: Text(
          'Энэ төрлийн төхөөрөмжид дүгнэлт бүртгэх тохиргоо идэвхгүй байна.',
          style: EmployeeTokens.microNote,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: FullWidthButton(
        label: 'Дүгнэлт тайлан бичих',
        icon: Icons.assignment_turned_in_outlined,
        onPressed: () => showAssessmentSheet(
          context,
          objectId: device.id,
          deviceLabel: device.code.isEmpty
              ? device.name
              : '${device.code} · ${device.name}',
          currentScore: device.score,
        ),
      ),
    );
  }
}

/// The device's written history.
///
/// `GET /objects-master/:id/history` returns two views of the same records: a
/// `timeline` of every event (assessments, measurements, requests, planned work and
/// audit rows) and the full `assessments` behind the assessment rows. The timeline is
/// what is listed; tapping a row that has a full assessment opens it.
class _HistorySection extends ConsumerWidget {
  const _HistorySection({required this.objectId, required this.deviceLabel});

  final String objectId;
  final String deviceLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ProjectAsyncView<ObjectHistoryModel>(
      value: ref.watch(objectHistoryProvider(objectId)),
      onRetry: () => ref.invalidate(objectHistoryProvider(objectId)),
      builder: (BuildContext ctx, ObjectHistoryModel history) {
        if (history.timeline.isEmpty) {
          return const ProjectEmptyState(
            icon: Icons.history_outlined,
            message: 'Энэ төхөөрөмжид бүртгэгдсэн тайлан, түүх алга байна.',
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            ProjectCard(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  for (int i = 0; i < history.timeline.length; i++)
                    _HistoryRow(
                      entry: history.timeline[i],
                      assessment: history.assessmentFor(history.timeline[i]),
                      deviceLabel: deviceLabel,
                      isLast: i == history.timeline.length - 1,
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EmployeeTokens.labelGutter,
                0,
                EmployeeTokens.labelGutter,
                0,
              ),
              child: Text(
                '${history.assessments.length} дүгнэлт · '
                '${history.timeline.length} бичлэг. Дүгнэлт бүхий мөрийг дарж '
                'тайланг бүтнээр нь харна.',
                style: EmployeeTokens.microNote,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({
    required this.entry,
    required this.assessment,
    required this.deviceLabel,
    required this.isLast,
  });

  final ObjectHistoryEntryModel entry;
  final ObjectAssessmentModel? assessment;
  final String deviceLabel;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = entry.riskLevel;
    final ObjectHistoryKind kind = entry.kind ?? ObjectHistoryKind.audit;
    final ObjectAssessmentModel? full = assessment;

    return TimelineEntry(
      title: entry.title,
      meta: joinParts(<String?>[
        formatDateTime(entry.occurredAt),
        entry.actorName,
        kind.label,
        entry.newScore == null ? null : 'Оноо ${entry.newScore}',
      ]),
      excerpt: entry.detail,
      tone: band?.tone ?? Tone.neutral,
      icon: kind.glyph,
      isLast: isLast,
      trailing: band == null
          ? null
          : EmployeePill(
              label: band.shortLabel,
              tone: band.tone,
              showGlyph: true,
              glyphLevel: band,
              semanticLabel: band.label,
            ),
      onTap: full == null
          ? null
          : () => ReportSheet.show(
                context,
                ReportView.fromAssessment(full, deviceLabel: deviceLabel),
              ),
    );
  }
}
