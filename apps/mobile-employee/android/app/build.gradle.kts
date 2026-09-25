import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/*
 * Firebase, applied only when its configuration is actually present.
 *
 * google-services.json is gitignored — it is regenerated per environment — so a fresh
 * checkout does not have one. Applying the plugin unconditionally would fail the build for
 * every developer with the message "File google-services.json is missing", turning an
 * optional feature into a prerequisite for compiling at all.
 *
 * With the file absent the app builds and runs exactly as before; Firebase.initializeApp
 * fails at runtime, PushMessaging catches it, and notifications stay in-app. Drop the file
 * in and push starts working with no code change.
 */
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release signing material, kept out of the repository. See android/key.properties.example.
// When the file is absent the release build falls back to the debug key, so a developer
// without the keystore can still run `flutter build apk --release` locally.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}

android {
    namespace = "mn.monhorus.monhorus_employee"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        /*
         * Required by flutter_local_notifications, which uses java.time APIs that do not
         * exist below API 26. Without this the build fails outright with "Dependency
         * ':flutter_local_notifications' requires core library desugaring to be enabled".
         *
         * minSdk here is 24, so this is not optional: desugaring is what lets those APIs
         * run on the older devices this app still supports.
         */
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        /*
         * Renamed from mn.monhorus.* to mn.itsystem.* on 2026-08-18, to match the Android
         * apps registered in Firebase project monhorus-78b1c and to use reverse-DNS of a
         * domain the project actually owns (itsystem.mn).
         *
         * This is a BREAKING change for anyone who already has the app. Android identifies
         * an app by this string, so the renamed build does not update the installed one --
         * it installs alongside it. Every existing user must uninstall the old app and
         * install the new one, losing on-device data. Accepted deliberately when the
         * rename was chosen over re-registering the Firebase apps.
         *
         * `namespace` above is deliberately NOT renamed. It sets the package for the
         * generated R and BuildConfig classes, and AndroidManifest resolves ".MainActivity"
         * against it, so changing it would also mean relocating the Kotlin sources. The
         * google-services plugin matches on applicationId, so this is what had to move.
         */
        applicationId = "mn.itsystem.monhorusEmployee"
        // Pinned, not inherited from flutter.minSdkVersion: android:networkSecurityConfig
        // is ignored below API 24, and that attribute is the only reason a release build
        // can reach the plaintext API host at all.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                // Debug keys are a publicly known shared key. An APK signed with them
                // cannot be updated in place by a properly signed build later, so this
                // path is for local development only -- never for a published APK.
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Pairs with isCoreLibraryDesugaringEnabled above; flutter_local_notifications
    // documents 2.1.4 as its floor.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
