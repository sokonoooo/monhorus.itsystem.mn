/// The service-request vocabulary, transcribed from
/// `packages/shared/src/constants/service-request.ts`.
///
/// It lives here rather than inside one tab because two of them read the same rows:
/// the Нүүр tab lists the requests assigned to the reader, and the Ажил tab's
/// "Нээлттэй" segment lists the unclaimed pool. A feature must not import across a
/// sibling feature, and a second transcription would be a second set of labels for
/// states the server has already named — so the vocabulary was lifted out of
/// `home/domain/entities/work_enums.dart`, which now re-exports it for the call sites
/// that were already there.
///
/// Labels are the backend's own Mongolian strings. Every `fromWire` degrades to null
/// rather than throwing, so an enum value added by a newer API version renders as
/// unknown instead of crashing a technician's screen.
library;

/// A colour band, kept out of the presentation layer so a status can carry its
/// severity without this file importing Flutter.
///
/// Named for what it is rather than for where it started: it was `HomeBand` while the
/// only reader was the home tab, and each tab maps it onto its own palette —
/// `home/presentation/theme/home_tones.dart` and the Ажил tab's own card.
enum SeverityBand { neutral, ink, green, yellow, red }

/// `SERVICE_REQUEST_STATUSES`, all fourteen, in the backend's order.
enum ServiceRequestStatus {
  createdNew('NEW', 'Шинэ', SeverityBand.neutral),
  unassigned('UNASSIGNED', 'Хуваарилагдаагүй', SeverityBand.neutral),
  assigned('ASSIGNED', 'Хуваарилагдсан', SeverityBand.neutral),
  accepted('ACCEPTED', 'Хүлээн авсан', SeverityBand.neutral),
  onTheWay('ON_THE_WAY', 'Замдаа', SeverityBand.yellow),
  onSite('ON_SITE', 'Очсон', SeverityBand.yellow),
  inProgress('IN_PROGRESS', 'Гүйцэтгэж байна', SeverityBand.yellow),
  waiting('WAITING', 'Түр хүлээгдсэн', SeverityBand.yellow),
  reportSubmitted('REPORT_SUBMITTED', 'Тайлан илгээсэн', SeverityBand.neutral),
  verification('VERIFICATION', 'Баталгаажуулах', SeverityBand.neutral),
  completed('COMPLETED', 'Дууссан', SeverityBand.green),
  revisitRequired('REVISIT_REQUIRED', 'Дахин очих', SeverityBand.red),
  returned('RETURNED', 'Буцаасан', SeverityBand.red),
  cancelled('CANCELLED', 'Цуцалсан', SeverityBand.neutral);

  const ServiceRequestStatus(this.wireValue, this.label, this.band);

  final String wireValue;
  final String label;
  final SeverityBand band;

  static ServiceRequestStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final ServiceRequestStatus status in ServiceRequestStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }

  /// Finished, in the sense that nothing further is expected of the technician.
  bool get isTerminal =>
      this == ServiceRequestStatus.completed ||
      this == ServiceRequestStatus.cancelled;

  bool get isOutstanding => !isTerminal;

  bool get isInProgress =>
      this == ServiceRequestStatus.onTheWay ||
      this == ServiceRequestStatus.onSite ||
      this == ServiceRequestStatus.inProgress;

  /// The two statuses a request sits in while nobody is assigned to it.
  ///
  /// Both, not one: `SERVICE_REQUEST_STATUSES` carries NEW and UNASSIGNED as separate
  /// states — the first is what intake writes, the second is what a dispatcher leaves
  /// behind when they un-assign — and a pool listing that queried only one of them
  /// would silently hide half the backlog.
  static const List<ServiceRequestStatus> unclaimed = <ServiceRequestStatus>[
    ServiceRequestStatus.unassigned,
    ServiceRequestStatus.createdNew,
  ];
}

/// `SERVICE_REQUEST_TYPES`.
///
/// The list DTO carries no free-text description, so this label is the most
/// meaningful title a list card can print for a request that names no device.
enum ServiceRequestType {
  plannedInspection('PLANNED_INSPECTION', 'Төлөвлөгөөт үзлэг'),
  repair('REPAIR', 'Засвар үйлчилгээ'),
  standardCall('STANDARD_CALL', 'Энгийн дуудлага'),
  urgentCall('URGENT_CALL', 'Яаралтай дуудлага'),
  installation('INSTALLATION', 'Шинэ угсралт/өргөтгөл'),
  revisit('REVISIT', 'Давтан үзлэг');

  const ServiceRequestType(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static ServiceRequestType? fromWire(String? value) {
    if (value == null) return null;
    for (final ServiceRequestType type in ServiceRequestType.values) {
      if (type.wireValue == value) return type;
    }
    return null;
  }
}

/// `SLA_STATES`.
enum SlaState {
  started('STARTED', 'Эхэлсэн', SeverityBand.neutral),
  nearBreach('NEAR_BREACH', 'Ойртсон', SeverityBand.yellow),
  atRisk('AT_RISK', 'Зөрчих эрсдэлтэй', SeverityBand.yellow),
  breached('BREACHED', 'Зөрчсөн', SeverityBand.red),
  withinSla('WITHIN_SLA', 'SLA дотор дууссан', SeverityBand.green),
  late('LATE', 'Хоцорсон', SeverityBand.red);

  const SlaState(this.wireValue, this.label, this.band);

  final String wireValue;
  final String label;
  final SeverityBand band;

  static SlaState? fromWire(String? value) {
    if (value == null) return null;
    for (final SlaState state in SlaState.values) {
      if (state.wireValue == value) return state;
    }
    return null;
  }

  /// The deadline is in danger or already missed.
  bool get needsAttention =>
      this == SlaState.nearBreach ||
      this == SlaState.atRisk ||
      this == SlaState.breached;
}
