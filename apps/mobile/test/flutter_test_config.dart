import 'dart:async';

import 'package:google_fonts/google_fonts.dart';

/// Test setup that runs before every test file in this package.
///
/// WHY THIS EXISTS. `customer_tokens.dart` builds the app's text theme through
/// `google_fonts`, which fetches Fira Sans from fonts.gstatic.com at runtime and caches
/// it. In a widget test that means the suite reaches the network, so whether a test
/// passes depends on whether the machine happened to be online and warm — which is not a
/// property of the code under test.
///
/// When the fetch fails, the fallback metrics differ from Fira Sans, so text lays out at
/// a different size. Tests that tap a widget found BY ITS TEXT are the ones that break:
/// the finder resolves to a different box, or the hit test lands outside it. That is
/// exactly the failure that was seen — four files, every one of them tapping on text
/// («Илгээх», «ХЭВИЙН», «Бүгдийг уншсан»), all passing again once the network returned.
///
/// `allowRuntimeFetching = false` makes `google_fonts` use the bundled fallback instead
/// of reaching out, so every run gets the same metrics whether or not there is a network.
///
/// SET HERE RATHER THAN PER FILE. It was previously set in `setUpAll` in
/// `floor_plan_markers_test.dart` only, and in three files in `apps/mobile-employee`.
/// The flag is a global static, but `flutter test` gives each test file its own isolate,
/// so setting it in one file does nothing for any other — which is why that one file kept
/// passing while its neighbours failed. `flutter_test_config.dart` is the only hook that
/// runs for every file in the package, so it is the only place the guarantee can be made
/// once. The per-file `setUpAll` calls are left alone: they are now redundant rather than
/// wrong, and removing them is a separate change.
///
/// See `apps/mobile-employee/test/flutter_test_config.dart`, which is identical.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  GoogleFonts.config.allowRuntimeFetching = false;
  await testMain();
}
