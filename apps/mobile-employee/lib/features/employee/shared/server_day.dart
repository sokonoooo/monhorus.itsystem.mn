/// Which day it is **where the system runs**, not where the handset is.
///
/// Every figure in this app labelled «Өнөөдөр» is a claim about a calendar day, and the
/// calendar day that matters is the server's: `env.APP_TIMEZONE` is what
/// `dayBounds(now, ...)` uses to decide what falls due today, what the dashboard's
/// `today` block counts, and which rows `GET /calendar` returns for a date. The device
/// had no part in any of that and was nonetheless the thing deciding where midnight fell,
/// through `DateTime.now().toLocal()`.
///
/// It is not a hypothetical. A technician who travels, a phone left on automatic
/// time-zone at a border, a tablet somebody set to the wrong region once — each of them
/// drew a different «Өнөөдөр» from the same rows, and the KPI strip disagreed with the
/// dispatch board with nothing on screen to say why.
///
/// The server already publishes the answer and nobody read it: `timezone` is on the
/// dashboard's `today` block and on every `GET /calendar` result. This file is where it
/// lands, and [endOfServerDay] is what the counters ask instead of the handset.
///
/// **It is a default, not a dependency**, exactly as `server_vocabulary.dart` beside it
/// is. Until a read has landed — and if one never does — every function here falls back
/// to the device's own local day, which is what the app did before this file existed. A
/// wrong-by-a-day figure on a phone in the wrong region is the bug being fixed; a blank
/// screen on a phone with no signal would be a worse one.
///
/// A top-level holder rather than something read off a `Ref`, for the same reason the
/// vocabulary is one: the things that need it are getters on plain model classes —
/// `PlannedWorkBoard.dueTodayCount`, `AssignedRequests.dueTodayCount` — reached from
/// widgets that hold no `Ref`. It is written by the providers that perform the reads, and
/// nothing else may write it.
library;

import 'package:timezone/data/latest_10y.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

/// The IANA name the server reported, or null when none has been reported yet.
String? _installedName;

/// The resolved zone. Null when nothing has been installed, or when the name the server
/// sent is not in this build's database.
tz.Location? _installedZone;

bool _databaseReady = false;

/// The zone name in force, or null when the app is still running on the handset's.
String? get serverTimezone => _installedName;

/// Whether a day boundary asked for below is the server's rather than the device's.
///
/// A screen that wants to know whether it is entitled to print «Өнөөдөр» as a fact reads
/// this; nothing here decides that for it.
bool get serverTimezoneIsKnown => _installedZone != null;

/// Installs the zone the server named — `today.timezone` on the dashboard, `timezone` on
/// a calendar result.
///
/// An empty or unparseable name is ignored rather than installed: a name this build's
/// database does not carry says nothing about where the server is, and replacing a good
/// zone with a broken one would be a downgrade dressed up as an update. Loading the
/// database is deferred to the first install, so an app that never reaches the server
/// never pays for it.
void installServerTimezone(String? name) {
  final String? trimmed = name?.trim();
  if (trimmed == null || trimmed.isEmpty) return;
  if (trimmed == _installedName) return;

  try {
    if (!_databaseReady) {
      tz_data.initializeTimeZones();
      _databaseReady = true;
    }
    final tz.Location? zone = _resolve(trimmed);
    if (zone == null) return;
    _installedZone = zone;
    _installedName = trimmed;
  } catch (_) {
    // A zone this build has never heard of, or a database that would not load. Either
    // way the fallback below is the behaviour the app already had.
  }
}

/// The zone for an IANA name, or null when this build's database has no such zone.
///
/// `UTC` AND `GMT` NEED THE SPECIAL CASE, and finding that out is the reason it is here:
/// the bundled database stores only canonical zone names and prunes the links, so
/// `getLocation('UTC')` throws even though the zone plainly exists — it is filed under
/// `Etc/UTC`. `APP_TIMEZONE` defaults to `Asia/Ulaanbaatar` and resolves directly, but
/// `UTC` is the single most likely value for an operator to set instead, and it would
/// have silently fallen back to the handset: the one configuration where the app is
/// certain what the server means is the one it would have got wrong.
tz.Location? _resolve(String name) {
  try {
    return tz.getLocation(name);
  } catch (_) {
    // Fall through to the aliases below.
  }

  final String upper = name.toUpperCase();
  if (upper == 'UTC' || upper == 'GMT' || upper == 'Z') return tz.UTC;

  try {
    return tz.getLocation('Etc/$name');
  } catch (_) {
    return null;
  }
}

/// Drops back to the handset's own day. For tests, which share a process and would
/// otherwise leak one case's server into the next.
void resetServerTimezone() {
  _installedName = null;
  _installedZone = null;
}

/// The last instant of the calendar day that [at] falls in, in the server's zone.
///
/// This is the boundary «Өнөөдөр» means: a deadline at or before it is due today, and one
/// after it is not. It is returned as an ordinary [DateTime] so it can be compared
/// against the UTC instants the API sends without either side being converted first.
///
/// Falls back to the device's local end of day when no zone has been installed, which is
/// the same arithmetic the counters used to do inline.
DateTime endOfServerDay({DateTime? at}) {
  final DateTime instant = at ?? DateTime.now();
  final tz.Location? zone = _installedZone;

  if (zone == null) {
    final DateTime local = instant.toLocal();
    return DateTime(local.year, local.month, local.day, 23, 59, 59, 999);
  }

  final tz.TZDateTime local = tz.TZDateTime.from(instant, zone);
  return tz.TZDateTime(
    zone,
    local.year,
    local.month,
    local.day,
    23,
    59,
    59,
    999,
  );
}

/// The first instant of the calendar day that [at] falls in, in the server's zone.
///
/// The other half of the same window, for a caller that has to ask for a day rather than
/// filter one — `GET /calendar` takes `from` and `to`, and a request built from the
/// handset's midnight asks the server for the wrong day either side of it.
DateTime startOfServerDay({DateTime? at}) {
  final DateTime instant = at ?? DateTime.now();
  final tz.Location? zone = _installedZone;

  if (zone == null) {
    final DateTime local = instant.toLocal();
    return DateTime(local.year, local.month, local.day);
  }

  final tz.TZDateTime local = tz.TZDateTime.from(instant, zone);
  return tz.TZDateTime(zone, local.year, local.month, local.day);
}

/// Whether [moment] falls on or before the end of the server's current day.
///
/// Null is never "today": a record with no deadline is not due, and counting it would put
/// work with no date at all into a figure about the next few hours.
bool isDueByEndOfServerDay(DateTime? moment, {DateTime? now}) {
  if (moment == null) return false;
  return !moment.isAfter(endOfServerDay(at: now));
}
