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
///
/// The status labels here are DEFAULTS. An administrator may rename a workflow step,
/// and `GET /vocabulary` is where this app reads what they called it — see
/// `server_vocabulary.dart` beside this file, and [ServiceRequestStatus.label], which
/// is a getter over that answer so the rename reaches every call site without one of
/// them changing.
library;

import 'server_vocabulary.dart';

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
  reportSubmitted('REPORT_SUBMITTED', 'Дүгнэлт илгээсэн', SeverityBand.neutral),
  verification('VERIFICATION', 'Баталгаажуулах', SeverityBand.neutral),
  completed('COMPLETED', 'Дууссан', SeverityBand.green),
  revisitRequired('REVISIT_REQUIRED', 'Дахин очих', SeverityBand.red),
  returned('RETURNED', 'Буцаасан', SeverityBand.red),
  cancelled('CANCELLED', 'Цуцалсан', SeverityBand.neutral);

  const ServiceRequestStatus(this.wireValue, this._bundledLabel, this.band);

  final String wireValue;

  /// The step name as `SERVICE_REQUEST_STATUS_LABELS` had it at build time.
  final String _bundledLabel;

  /// What this installation calls the step, falling back to the compiled name.
  ///
  /// A stage renames a status only when it covers that status alone — see
  /// `serverStageLabelForStatus`, which explains why a coarser stage name must not be
  /// substituted here. «Очсон» and «Гүйцэтгэж байна» are two moves a technician
  /// chooses between, and one word for both would make the control unusable.
  String get label => serverStageLabelForStatus(wireValue) ?? _bundledLabel;

  /// The colour name of the stage this status sits in, or null when the server has
  /// not been read or groups it under nothing. Resolved to a triad by `Tone.named`.
  String? get stageColour => serverStageColourForStatus(wireValue);

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

  /// Whether the technician has actually reached the site by the time a request is in
  /// this state.
  ///
  /// ON_SITE is the arrival itself; the other four are the states a request can only be in
  /// once that arrival has been reported — IN_PROGRESS, REPORT_SUBMITTED, VERIFICATION and
  /// COMPLETED.
  ///
  /// WAITING IS DELIBERATELY ABSENT, and it is the reason this is a named set rather than
  /// a position in `values`. `SERVICE_REQUEST_TRANSITIONS` allows ON_THE_WAY → WAITING, so
  /// a technician can be paused — on a key, on a customer, on a part — without ever having
  /// reached the site, and reading WAITING as arrival would let them write up a visit they
  /// have not made. WAITING → ON_SITE is the edge that records the arrival afterwards.
  ///
  /// Everything before arrival — NEW, UNASSIGNED, ASSIGNED, ACCEPTED, ON_THE_WAY — and
  /// every state that says nothing about it — WAITING, RETURNED, REVISIT_REQUIRED,
  /// CANCELLED — reads false, so a control gated on this stays withheld until the arrival
  /// is on the record.
  bool get hasArrivedOnSite => _arrived.contains(this);

  static const List<ServiceRequestStatus> _arrived = <ServiceRequestStatus>[
    ServiceRequestStatus.onSite,
    ServiceRequestStatus.inProgress,
    ServiceRequestStatus.reportSubmitted,
    ServiceRequestStatus.verification,
    ServiceRequestStatus.completed,
  ];

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

  /// Whether a move to this state has to carry a free-text reason.
  ///
  /// `REASON_REQUIRED_STATUSES`. Of the four the backend names, only WAITING is also a
  /// state this app can offer, so it is the only one a technician is ever prompted for —
  /// but the whole list is transcribed rather than the one entry, because the rule belongs
  /// to the domain and not to this screen's current permissions.
  bool get requiresReason =>
      this == ServiceRequestStatus.waiting ||
      this == ServiceRequestStatus.returned ||
      this == ServiceRequestStatus.cancelled ||
      this == ServiceRequestStatus.revisitRequired;

  /// `SELF_PROGRESS_STATUSES` — the states `service_request.self_progress` authorises.
  ///
  /// The six a person standing at the site is the only honest source for. CANCELLED,
  /// RETURNED, UNASSIGNED, VERIFICATION, COMPLETED and REVISIT_REQUIRED are deliberately
  /// absent: each is a decision ABOUT the job — planning, a judgement on somebody's
  /// write-up, or the office's sign-off — rather than a report FROM it.
  bool get isSelfProgress => _selfProgress.contains(this);

  static const List<ServiceRequestStatus> _selfProgress = <ServiceRequestStatus>[
    ServiceRequestStatus.accepted,
    ServiceRequestStatus.onTheWay,
    ServiceRequestStatus.onSite,
    ServiceRequestStatus.inProgress,
    ServiceRequestStatus.waiting,
    ServiceRequestStatus.reportSubmitted,
  ];

  /// The moves a self-progress holder may be OFFERED from here: legal for the request AND
  /// inside the set above.
  ///
  /// Mirrors `selfProgressTransitionsFrom` in
  /// `packages/shared/src/constants/service-request.ts`, and mirrors it as an
  /// INTERSECTION rather than as a hand-written list per state. A hand-written list is how
  /// a control ends up offering ASSIGNED → IN_PROGRESS: plausible, in the permitted set,
  /// and not an edge the graph has. The server is still the authority and refuses either
  /// way; this only decides what to draw.
  ///
  /// Empty for most states, and that is correct rather than a gap: from NEW, UNASSIGNED,
  /// REPORT_SUBMITTED, VERIFICATION, COMPLETED, REVISIT_REQUIRED and CANCELLED there is
  /// nothing a technician may do on their own, so the control is simply not drawn.
  List<ServiceRequestStatus> get selfProgressTargets =>
      transitions.where((ServiceRequestStatus to) => to.isSelfProgress).toList(
            growable: false,
          );

  /// `SERVICE_REQUEST_TRANSITIONS` — every move the backend's matrix allows from here.
  List<ServiceRequestStatus> get transitions =>
      _transitions[this] ?? const <ServiceRequestStatus>[];

  /// The moves a person may ASK for, which is deliberately narrower than the backend's.
  ///
  /// `SERVICE_REQUEST_TRANSITIONS` also admits ON_SITE → REPORT_SUBMITTED and
  /// REPORT_SUBMITTED → COMPLETED. Neither is offered here as a button, because neither is
  /// a thing a technician should do by hand: submitting the Дүгнэлт moves the request to
  /// «Дүгнэлт илгээсэн» on its own, and approving it completes the request. Offering the
  /// first as a manual step would produce a refusal — the backend will not accept
  /// REPORT_SUBMITTED with no conclusion behind it — and the second is an office act.
  static const Map<ServiceRequestStatus, List<ServiceRequestStatus>> _transitions =
      <ServiceRequestStatus, List<ServiceRequestStatus>>{
    ServiceRequestStatus.createdNew: <ServiceRequestStatus>[
      ServiceRequestStatus.unassigned,
      ServiceRequestStatus.assigned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.unassigned: <ServiceRequestStatus>[
      ServiceRequestStatus.assigned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.assigned: <ServiceRequestStatus>[
      ServiceRequestStatus.accepted,
      ServiceRequestStatus.unassigned,
      ServiceRequestStatus.returned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.accepted: <ServiceRequestStatus>[
      ServiceRequestStatus.onTheWay,
      ServiceRequestStatus.unassigned,
      ServiceRequestStatus.returned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.onTheWay: <ServiceRequestStatus>[
      ServiceRequestStatus.onSite,
      ServiceRequestStatus.waiting,
      ServiceRequestStatus.returned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.onSite: <ServiceRequestStatus>[
      ServiceRequestStatus.inProgress,
      ServiceRequestStatus.waiting,
      ServiceRequestStatus.returned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.inProgress: <ServiceRequestStatus>[
      ServiceRequestStatus.reportSubmitted,
      ServiceRequestStatus.waiting,
      ServiceRequestStatus.revisitRequired,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.waiting: <ServiceRequestStatus>[
      ServiceRequestStatus.inProgress,
      ServiceRequestStatus.onSite,
      ServiceRequestStatus.returned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.reportSubmitted: <ServiceRequestStatus>[
      ServiceRequestStatus.verification,
      ServiceRequestStatus.returned,
    ],
    ServiceRequestStatus.verification: <ServiceRequestStatus>[
      ServiceRequestStatus.completed,
      ServiceRequestStatus.returned,
      ServiceRequestStatus.revisitRequired,
    ],
    ServiceRequestStatus.completed: <ServiceRequestStatus>[],
    ServiceRequestStatus.revisitRequired: <ServiceRequestStatus>[
      ServiceRequestStatus.assigned,
      ServiceRequestStatus.unassigned,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.returned: <ServiceRequestStatus>[
      ServiceRequestStatus.assigned,
      ServiceRequestStatus.inProgress,
      ServiceRequestStatus.cancelled,
    ],
    ServiceRequestStatus.cancelled: <ServiceRequestStatus>[],
  };
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
