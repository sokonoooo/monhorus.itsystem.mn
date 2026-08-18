import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../data/models/project_models.dart';
import '../../data/models/report_record_models.dart';
import '../../domain/entities/object_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/assessment_sheet.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/floor_plan_markers.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import '../widgets/report_record_sheet.dart';
import 'floor_detail_screen.dart';

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
            ..invalidate(objectReportsProvider(objectId));
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
            const SectionHeading('Тайлангууд'),
            _ReportsSection(
              objectId: objectId,
              deviceLabel: current == null
                  ? fallbackTitle
                  : (current.code.isEmpty
                      ? current.name
                      : '${current.code} · ${current.name}'),
            ),
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
                            // Flexible because these two sit in a column beside the
                            // score ring, which leaves them a little over 200px, and
                            // the longest band name — "Анхаарах шаардлагатай" — does
                            // not fit that at the real typeface's metrics. The pill
                            // ellipsises rather than overflowing its own chip; the
                            // full wording is still on the accessible label.
                            EmployeePill(
                              label: band?.label ?? unassessedLabel,
                              tone: riskTone(band),
                              showGlyph: true,
                              glyphLevel: band,
                              semanticLabel: riskSemanticLabel(band),
                              flexibleText: true,
                            ),
                            if (device.status != null)
                              EmployeePill(
                                label: device.status!.label,
                                tone: device.status!.tone,
                                flexibleText: true,
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

        // A panel is an enclosure, and what a technician opening one wants first is what
        // is inside it. Two lists rather than one: a circuit is FED BY the panel and a
        // device is HOUSED IN it, and a device that names both appears in each.
        if (device.childCircuits.isNotEmpty) ...<Widget>[
          SectionHeading('Хэлхээ (${device.childCircuits.length})', topPadding: 4),
          _ChildObjectList(objects: device.childCircuits, device: device),
        ],
        if (device.mountedEquipment.isNotEmpty) ...<Widget>[
          SectionHeading(
            'Самбарт байрлах тоноглол (${device.mountedEquipment.length})',
            topPadding: 4,
          ),
          _ChildObjectList(objects: device.mountedEquipment, device: device),
        ],

        const SectionHeading('Байршил', topPadding: 4),
        _LocationSection(device: device),

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

/// Where the equipment actually is, drawn on its floor's plan.
///
/// REPLACES THE PICTURE STRIP THAT USED TO SIT HERE. That strip rendered
/// `object.photos`, an array no route in this app can append to — `recordAssessment`
/// files evidence against the ASSESSMENT, never against the object — so for a
/// technician it was permanently empty and explained itself with an apology. A plan
/// with the device marked on it answers the question they were actually asking when
/// they scrolled this far: which of the things in this room is it.
///
/// `object.photos` is untouched on the model and still parsed. The field is real and
/// other clients render it; a screen choosing not to draw something is no reason to
/// stop reading it off the wire.
///
/// Read-only and un-zoomable, matching the fault plan on a service request. The whole
/// floor, pinchable, is one tap away on the breadcrumb.
class _LocationSection extends ConsumerWidget {
  const _LocationSection({required this.device});

  final ObjectDetailModel device;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PlanPositionModel? position = device.planPosition;
    final String? floorId = device.floorId;

    // Nothing to draw, and two different reasons for it, said apart: a device nobody
    // linked to a floor, versus one nobody has placed on the drawing.
    if (floorId == null || floorId.isEmpty) {
      return const ProjectEmptyState(
        icon: Icons.map_outlined,
        message: 'Энэ төхөөрөмж давхарт холбогдоогүй тул планд харуулах боломжгүй.',
      );
    }
    if (position == null) {
      return const ProjectEmptyState(
        icon: Icons.wrong_location_outlined,
        message: 'Энэ төхөөрөмжийг план дээр байрлуулаагүй байна.',
      );
    }

    return ProjectAsyncView<FloorPlanModel?>(
      value: ref.watch(floorPlanProvider(floorId)),
      onRetry: () => ref.invalidate(floorPlanProvider(floorId)),
      builder: (BuildContext ctx, FloorPlanModel? plan) {
        if (plan == null) {
          return const ProjectEmptyState(
            icon: Icons.map_outlined,
            message: 'Энэ давхарт план зураг импортлогдоогүй байна.',
          );
        }
        if (!plan.isImage) {
          return ProjectEmptyState(
            icon: Icons.description_outlined,
            message: '${plan.fileName} нь зураг биш файл тул планыг харуулах '
                'боломжгүй байна.',
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            ProjectCard(
              padding: EdgeInsets.zero,
              child: Container(
                color: EmployeeTokens.white,
                child: AuthenticatedImage.sizedToImage(
                  fileId: plan.fileId,
                  // The same layer the floor plan draws, handed one object. A marker
                  // here is then recognisably the marker the technician tapped to get
                  // here — same dot, same type icon, same risk colour — rather than a
                  // second visual vocabulary for the same equipment.
                  //
                  // Deliberately NOT filtered through `planMarkersOf`. That filter asks
                  // "may this type be scattered across a floor drawing", which is a
                  // question about a crowded plan; a reader who has opened one device
                  // and scrolled to its location has asked where THIS thing is, and the
                  // answer does not depend on whether its type is drawn on the floor
                  // overview. A placed object shows its position here either way.
                  overlay: FloorPlanMarkerLayer(
                    objects: <ObjectListItemModel>[device],
                    // Already on this device's screen; tapping it again goes nowhere.
                    onTap: (ObjectListItemModel _) {},
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EmployeeTokens.labelGutter,
                0,
                EmployeeTokens.labelGutter,
                10,
              ),
              child: Text(
                joinParts(<String?>[device.buildingName, device.floorName]),
                style: EmployeeTokens.microNote,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The circuits a panel feeds, or the devices bolted inside it.
///
/// Reuses [DeviceRow], the row the floor's own device list is built from, so a piece of
/// equipment looks and behaves the same wherever it is listed — including opening its
/// own detail screen on tap, which is what makes a panel navigable rather than just
/// descriptive.
class _ChildObjectList extends StatelessWidget {
  const _ChildObjectList({required this.objects, required this.device});

  final List<ObjectListItemModel> objects;

  /// The panel being viewed. Read only for the names its children fall back to: a child
  /// row carries its own floor and building where the server sent them, and inherits
  /// the panel's otherwise, so the screen it opens is not left with an empty crumb.
  final ObjectDetailModel device;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        for (final ObjectListItemModel child in objects)
          DeviceRow(
            object: child,
            floorName: child.floorName ?? device.floorName ?? '',
            buildingName: child.buildingName ?? device.buildingName ?? '',
            projectName: '',
          ),
      ],
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
          // The type's own declared fields, and what this device has already answered.
          // Handed down rather than refetched inside the sheet: this screen has already
          // loaded the detail and both travel on it.
          attributes: device.objectType?.attributes ?? const <ObjectTypeAttributeModel>[],
          attributeValues: device.attributeValues,
        ),
      ),
    );
  }
}

/// Every report that recorded a finding on this piece of equipment.
///
/// REPLACES THE EVENT TIMELINE THAT USED TO SIT HERE. That list came from
/// `GET /objects-master/:id/history`, which folds measurements, audit rows and request
/// events in beside the written conclusions — a change log, useful to somebody auditing
/// the record and largely noise to a technician standing at the equipment asking what
/// was concluded about it. Only the rows that happened to resolve to a full assessment
/// could even be opened; the rest were text.
///
/// `GET /objects-master/:objectId/reports` answers the question directly, and answers it
/// across all four kinds — an assessment raised on the device, the result of a planned
/// work, the conclusion of a service request, and anything signed off as a consolidated
/// report. EVERY row here opens.
class _ReportsSection extends ConsumerWidget {
  const _ReportsSection({required this.objectId, required this.deviceLabel});

  final String objectId;
  final String deviceLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ProjectAsyncView<List<ReportRecordModel>>(
      value: ref.watch(objectReportsProvider(objectId)),
      onRetry: () => ref.invalidate(objectReportsProvider(objectId)),
      builder: (BuildContext ctx, List<ReportRecordModel> reports) {
        if (reports.isEmpty) {
          return const ProjectEmptyState(
            icon: Icons.description_outlined,
            message: 'Энэ төхөөрөмжид бүртгэгдсэн тайлан алга байна.',
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final ReportRecordModel report in reports)
              _ReportRow(
                report: report,
                objectId: objectId,
                deviceLabel: deviceLabel,
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EmployeeTokens.labelGutter,
                4,
                EmployeeTokens.labelGutter,
                0,
              ),
              child: Text(
                '${reports.length} тайлан. Мөрийг дарж дэлгэрэнгүйг харна.',
                style: EmployeeTokens.microNote,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// One report row, built from the same [ProjectRow] the device lists use.
class _ReportRow extends StatelessWidget {
  const _ReportRow({
    required this.report,
    required this.objectId,
    required this.deviceLabel,
  });

  final ReportRecordModel report;
  final String objectId;
  final String deviceLabel;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = report.riskLevel;

    return ProjectRow(
      leading: RowTile(
        tone: riskTone(band),
        // The score where the report carries one, the type's glyph otherwise. A tile
        // reading "0" would state a score nobody recorded.
        text: report.overallScore == null ? null : '${report.overallScore}',
        icon: report.overallScore == null ? Icons.description_outlined : null,
        level: band,
        showGlyph: true,
      ),
      title: report.titleLine,
      subtitle: joinParts(<String?>[
        formatDate(report.occurredAt),
        report.status?.label,
        report.approvedByName,
      ]),
      trailing: RiskPill(score: report.overallScore, level: band),
      onTap: () => ReportRecordSheet.show(
        context,
        reportId: report.id,
        objectId: objectId,
        deviceLabel: deviceLabel,
      ),
    );
  }
}
