import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Metadata for an uploaded file.
 *
 * The binary lives on disk under a generated opaque name; `storageKey` is that name,
 * never a full path and never the caller-supplied filename. Downloads are served by an
 * authenticated route that resolves the key against the configured upload directory,
 * so a server path is never exposed and a caller cannot traverse the filesystem.
 */
/**
 * Owner kinds. The download route maps each to the permission a caller must hold, so a
 * new kind must be added here and to that mapping together.
 */
export const STORED_FILE_OWNER_TYPES = [
  'EMPLOYEE',
  'SERVICE_REQUEST',
  'PLANNED_WORK_TASK',
  'FLOOR_PLAN',
  'OBJECT',
] as const;
export type StoredFileOwnerType = (typeof STORED_FILE_OWNER_TYPES)[number];

export interface IStoredFile {
  /** Opaque generated name, for example 3f2a...c81.bin. Not user controlled. */
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;

  /** Logical owner, used for the permission check on download. */
  ownerType: StoredFileOwnerType;
  ownerId: Types.ObjectId;

  uploadedBy: Types.ObjectId | null;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const storedFileSchema = new Schema<IStoredFile>(
  {
    storageKey: { type: String, required: true, unique: true },
    originalName: { type: String, required: true, maxlength: 300 },
    mimeType: { type: String, required: true, maxlength: 150 },
    sizeBytes: { type: Number, required: true, min: 0 },

    ownerType: { type: String, enum: STORED_FILE_OWNER_TYPES, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },

    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedByName: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

storedFileSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });

export const StoredFile: Model<IStoredFile> = model<IStoredFile>('StoredFile', storedFileSchema);
