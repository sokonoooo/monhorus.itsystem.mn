import 'dart:async';

import 'package:google_fonts/google_fonts.dart';

/// Test setup that runs before every test file in this package.
///
/// WHY THIS EXISTS. `employee_tokens.dart` builds the app's text theme through
/// `google_fonts`, which fetches its faces from fonts.gstatic.com at runtime and caches
/// them. In a widget test that means the suite reaches the network, so whether a test
/// passes depends on whether the machine happened to be online and warm — which is not a
/// property of the code under test.
///
/// When the fetch fails, the fallback metrics differ, so text lays out at a different
/// size and any test that taps a widget found BY ITS TEXT can miss it. This app has been
/// carrying the symptom for a while: `service_request_fault_pin_test.dart:210` and
/// `floor_plan_markers_test.dart:306` both swallow any error whose text contains `font`.
/// Those workarounds treat the flake as weather; this removes the weather.
///
/// SET HERE RATHER THAN PER FILE. The flag is a global static, but `flutter test` gives
/// each test file its own isolate, so the `setUpAll` calls in
/// `service_request_fault_pin_test.dart`, `floor_plan_markers_test.dart` and
/// `device_detail_render_test.dart` protected only themselves — every other file in this
/// package still fetched. `flutter_test_config.dart` is the only hook that runs for every
/// file in the package, so it is the only place the guarantee can be made once. The
/// per-file `setUpAll` calls are left alone: they are now redundant rather than wrong,
/// and removing them — along with the two `contains('font')` swallows this makes
/// unnecessary — is a separate change.
///
/// See `apps/mobile/test/flutter_test_config.dart`, which is identical.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  GoogleFonts.config.allowRuntimeFetching = false;
  await testMain();
}
