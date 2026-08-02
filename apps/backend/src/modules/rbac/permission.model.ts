import type { PermissionKey, PermissionModule } from '@monhorus/shared';
import { Schema, model, type Model } from 'mongoose';

/**
 * Materialised copy of the shared permission catalogue.
 *
 * The catalogue in packages/shared remains the source of truth; this collection
 * exists so the RBAC admin screen can list permissions with labels, and so a Role
 * document can be validated against a real reference set.
 */
export interface IPermission {
  key: PermissionKey;
  module: PermissionModule;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

const permissionSchema = new Schema<IPermission>(
  {
    key: { type: String, required: true, unique: true },
    module: { type: String, required: true, index: true },
    label: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

export const Permission: Model<IPermission> = model<IPermission>('Permission', permissionSchema);
