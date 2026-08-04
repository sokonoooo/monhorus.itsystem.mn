/// Camera and gallery access for evidence photos.
///
/// One place decides three things the rest of the app must not re-decide:
///
///   1. **What the backend will accept.** `storage.service.ts` allows `image/jpeg`,
///      `image/png` and `image/webp` only, and caps a file at 10 MB. Both limits are
///      applied here, so a picture that cannot possibly be stored is refused on the
///      handset instead of after a round trip on a site connection.
///   2. **How a refusal is worded.** Every failure leaves as a [PhotoCaptureFailed]
///      carrying a Mongolian sentence. No `PlatformException`, no `toString()` of an
///      error object, ever reaches a widget.
///   3. **That "cancelled" is not an error.** Backing out of the camera is the most
///      common outcome of tapping a photo button, and it produces
///      [PhotoCaptureCancelled], which callers ignore silently.
///
/// The bytes are read eagerly rather than the path being passed around: the temporary
/// file `image_picker` writes is not guaranteed to outlive the picker on iOS, and the
/// upload needs bytes anyway.
///
/// Kept identical to `apps/mobile-employee/lib/core/media/photo_capture.dart` rather
/// than being adapted for the customer: the three decisions above are decisions about
/// what the SERVER accepts, and they must not diverge between the two apps. The wording
/// is deliberately audience-neutral for the same reason.
library;

import 'dart:io';

import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

/// The three ways a pick can end. Sealed so a caller cannot forget one.
sealed class PhotoCaptureResult {
  const PhotoCaptureResult();
}

/// A picture that passed the type and size checks and is ready to upload.
class PhotoCaptured extends PhotoCaptureResult {
  const PhotoCaptured(this.photo);

  final CapturedPhoto photo;
}

/// The user backed out. Not an error: nothing is shown.
class PhotoCaptureCancelled extends PhotoCaptureResult {
  const PhotoCaptureCancelled();
}

/// Something went wrong, already phrased for the user.
class PhotoCaptureFailed extends PhotoCaptureResult {
  const PhotoCaptureFailed(this.message);

  final String message;
}

/// An image in memory, with the two pieces of metadata a multipart upload needs.
class CapturedPhoto {
  const CapturedPhoto({
    required this.bytes,
    required this.filename,
    required this.mimeType,
  });

  final Uint8List bytes;

  /// Display name only. The server generates its own opaque storage key and keeps
  /// this as metadata, so it never touches a filesystem path.
  final String filename;

  final String mimeType;

  int get sizeBytes => bytes.length;
}

/// Where a picture comes from. The two the platform picker offers.
enum PhotoSource {
  camera('Камераар авах'),
  gallery('Зургийн сангаас сонгох');

  const PhotoSource(this.label);

  final String label;
}

/// Mirrors `MAX_FILE_BYTES` in the backend's storage service.
const int maxPhotoBytes = 10 * 1024 * 1024;

/// Mirrors the image half of `ALLOWED_MIME_TYPES` there.
const Map<String, String> _mimeByExtension = <String, String>{
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
};

/// Picks one photo and returns it as bytes.
///
/// [maxWidth] and [imageQuality] are deliberately opinionated. A modern handset
/// produces 4-6 MB frames that carry no more evidential detail at full resolution
/// than at 1920px, and a technician on a site connection pays for every byte. The
/// result is typically a few hundred kilobytes, well inside the server's 10 MB cap.
///
/// iOS returns HEIC captures re-encoded as JPEG, so the extension check below passes
/// for a normal camera roll. A picture that is somehow neither JPEG, PNG nor WebP is
/// refused here with the same sentence the server would have used.
Future<PhotoCaptureResult> capturePhoto({
  required PhotoSource source,
  ImagePicker? picker,
}) async {
  final ImagePicker imagePicker = picker ?? ImagePicker();

  try {
    final XFile? file = await imagePicker.pickImage(
      source: source == PhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: 1920,
      imageQuality: 85,
      preferredCameraDevice: CameraDevice.rear,
    );

    // Null is the cancel path on both platforms.
    if (file == null) return const PhotoCaptureCancelled();

    final Uint8List bytes = await file.readAsBytes();
    if (bytes.isEmpty) {
      return const PhotoCaptureFailed('Зураг хоосон байна. Дахин оролдоно уу.');
    }

    if (bytes.length > maxPhotoBytes) {
      return const PhotoCaptureFailed(
        'Зургийн хэмжээ 10 MB-аас хэтэрсэн байна. Багасгаж дахин оролдоно уу.',
      );
    }

    final String extension = _extensionOf(file.name.isEmpty ? file.path : file.name);
    final String? mimeType = _mimeByExtension[extension];
    if (mimeType == null) {
      return const PhotoCaptureFailed(
        'Зөвхөн JPG, PNG, WEBP зураг хавсаргана.',
      );
    }

    return PhotoCaptured(
      CapturedPhoto(
        bytes: bytes,
        filename: _displayName(file.name, extension),
        mimeType: mimeType,
      ),
    );
  } on PlatformException catch (error) {
    return PhotoCaptureFailed(_messageForPlatformError(error, source));
  } on FileSystemException {
    return const PhotoCaptureFailed('Сонгосон зургийг уншиж чадсангүй.');
  } catch (_) {
    // A picker can fail in ways no plugin documents; the user still gets a sentence
    // rather than a stack trace.
    return const PhotoCaptureFailed('Зураг авахад алдаа гарлаа. Дахин оролдоно уу.');
  }
}

/// Turns the plugin's error codes into something a technician can act on.
///
/// `camera_access_denied` and `photo_access_denied` are the two that matter: the
/// permission was refused once and iOS will not ask again, so the only remedy is the
/// Settings app, and the message says so.
String _messageForPlatformError(PlatformException error, PhotoSource source) {
  switch (error.code) {
    case 'camera_access_denied':
      return 'Камер ашиглах зөвшөөрөл олгогдоогүй байна. Тохиргоо → Монхорус '
          'хэсгээс камерын зөвшөөрлийг идэвхжүүлнэ үү.';
    case 'photo_access_denied':
      return 'Зургийн сан руу хандах зөвшөөрөл олгогдоогүй байна. Тохиргоо → '
          'Монхорус хэсгээс зургийн зөвшөөрлийг идэвхжүүлнэ үү.';
    case 'no_available_camera':
      return 'Энэ төхөөрөмж дээр камер олдсонгүй. Зургийн сангаас сонгоно уу.';
    case 'multiple_request':
      return 'Өмнөх сонголт хараахан дуусаагүй байна. Түр хүлээнэ үү.';
    case 'invalid_source':
      return 'Зургийн эх сурвалж буруу байна.';
    default:
      return source == PhotoSource.camera
          ? 'Камер нээхэд алдаа гарлаа. Дахин оролдоно уу.'
          : 'Зургийн сан нээхэд алдаа гарлаа. Дахин оролдоно уу.';
  }
}

String _extensionOf(String name) {
  final int dot = name.lastIndexOf('.');
  if (dot < 0 || dot == name.length - 1) return '';
  return name.substring(dot + 1).toLowerCase();
}

/// A stable, safe display name. The picker's own name can be empty or a bare
/// temporary path segment, and the server only keeps this as metadata.
String _displayName(String pickedName, String extension) {
  final String trimmed = pickedName.trim();
  if (trimmed.isNotEmpty && trimmed.contains('.')) return trimmed;
  return 'zurag_${DateTime.now().millisecondsSinceEpoch}.$extension';
}
