import type { PermissionKey } from '@monhorus/shared';
import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * Dynamic role. Permissions are stored as the shared catalogue's string keys rather
 * than as ObjectId references, so resolving a user's effective permission set needs
 * no extra join beyond populating the roles themselves.
 *
 * `isSystem` roles are seeded on boot and cannot be deleted or re-keyed, but their
 * permission sets stay editable by a holder of rbac.manage.
 */
export interface IRole {
  key: string;
  name: string;
  description: string | null;
  permissions: PermissionKey[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type RoleDocument = HydratedDocument<IRole>;

const roleSchema = new Schema<IRole>(
  {
    key: {
      type: String,
      required: [true, 'Role key заавал.'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z][A-Z0-9_]*$/, 'Role key буруу форматтай байна.'],
    },
    name: { type: String, required: [true, 'Role нэр заавал.'], trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, versionKey: false },
);

/**
 * Multikey index on the permission array.
 *
 * The notification pipeline resolves recipients by permission on every domain event, so
 * this lookup runs on the hot path of every status change, assignment and assessment.
 * Without the index each of those is a collection scan.
 */
roleSchema.index({ permissions: 1 });

export const Role: Model<IRole> = model<IRole>('Role', roleSchema);
