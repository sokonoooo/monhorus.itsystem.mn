import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';

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
