import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { MAX_OBJECT_TYPE_ICON_BYTES, OBJECT_TYPE_ICON_MIME } from '@monhorus/shared';
import multer, { MulterError, type FileFilterCallback } from 'multer';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { env } from '../../config/env';

/**
 * Local-disk file storage with an authenticated download route.
 *
 * Design constraints from requirements 16.2: uploaded files must not be publicly
 * reachable and must be served through an authenticated endpoint. Accordingly the
 * stored filename is generated server-side and is opaque; the caller's filename is
 * kept only as display metadata and never touches the filesystem.
 *
 * Swapping to object storage later means replacing this module alone; the routes and
 * the StoredFile model do not change.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function uploadDirectory(): string {
  return path.resolve(env.UPLOAD_DIR);
}

export function ensureUploadDirectory(): void {
  const dir = uploadDirectory();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Opaque, collision-resistant, and free of any caller-controlled characters. */
export function generateStorageKey(): string {
  return `${crypto.randomBytes(24).toString('hex')}.bin`;
}

function fileFilter(_req: Request, file: Express.Multer.File, callback: FileFilterCallback): void {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    callback(
      AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Зөвшөөрөгдөөгүй файлын төрөл. Зураг, PDF, Word, Excel файл оруулна уу.',
      ),
    );
    return;
  }
  callback(null, true);
}

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    ensureUploadDirectory();
    callback(null, uploadDirectory());
  },
  filename(_req, _file, callback) {
    callback(null, generateStorageKey());
  },
});

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
});

/**
 * Resolves a storage key to an absolute path, refusing anything that escapes the
 * upload directory. Defence against a tampered key even though keys are generated.
 */
export function resolveStoredFilePath(storageKey: string): string {
  const base = uploadDirectory();
  const resolved = path.resolve(base, storageKey);

  if (!resolved.startsWith(base + path.sep)) {
    throw AppError.forbidden(ERROR_CODES.FORBIDDEN, 'Файлын зам буруу байна.');
  }
  return resolved;
}

export function deleteStoredFile(storageKey: string): void {
  try {
    fs.unlinkSync(resolveStoredFilePath(storageKey));
  } catch {
    // Missing file on disk must not block deletion of its metadata row.
  }
}

/**
 * Writes bytes the server itself produced, under a fresh opaque key.
 *
 * Exists for the sanitised-SVG path: that upload is buffered in memory precisely so the
 * ORIGINAL never touches the disk, and what lands here is the parser's own output rather
 * than anything the caller sent.
 */
export function writeStoredFileBytes(contents: string | Buffer): string {
  ensureUploadDirectory();
  const storageKey = generateStorageKey();
  fs.writeFileSync(resolveStoredFilePath(storageKey), contents);
  return storageKey;
}

// -- SVG icons ---------------------------------------------------------------

/**
 * Accepts a single custom object-type icon into MEMORY, never onto the disk.
 *
 * Buffered on purpose. Every other upload here streams to disk and is inspected afterwards,
 * which is fine for a JPEG and wrong for an SVG: an unsanitised SVG is executable content,
 * and a system that writes one down before cleaning it has, however briefly, a hostile file
 * in its storage directory addressable by whatever else can read that directory. 64 KB fits
 * in memory a thousand times over.
 *
 * The content-type filter below is a cheap first gate and NOTHING MORE. The real check is
 * `sanitiseSvgIcon`, which parses the bytes and refuses anything that is not an SVG — a
 * caller who forges `image/svg+xml` on a PNG passes here and is rejected there.
 */
const svgIconUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(_req: Request, file: Express.Multer.File, callback: FileFilterCallback): void {
    if (file.mimetype !== OBJECT_TYPE_ICON_MIME) {
      callback(
        AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Зөвхөн SVG айкон оруулна.', [
          { field: 'file', message: 'SVG файл сонгоно уу.' },
        ]),
      );
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: MAX_OBJECT_TYPE_ICON_BYTES, files: 1 },
}).single('file');

/**
 * The middleware form, with multer's own errors translated.
 *
 * Without this an over-large file surfaces as a bare `MulterError`, which the terminal error
 * handler does not recognise and reports as a 500 — an input problem dressed up as a server
 * fault. The size ceiling is a rule about the request, so it answers 400 like every other one.
 */
export function acceptSvgIcon(req: Request, res: Response, next: NextFunction): void {
  svgIconUpload(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `Айкон ${Math.floor(MAX_OBJECT_TYPE_ICON_BYTES / 1024)}KB-аас том байж болохгүй.`
          : 'Файл хүлээн авах боломжгүй.';
      next(
        AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, message, [
          { field: 'file', message },
        ]),
      );
      return;
    }
    next(error);
  });
}
