import type { SettingValue } from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * A single administrator override.
 *
 * Only overridden keys are stored. A key absent from this collection takes its value from
 * the shared catalogue default, so a fresh database behaves exactly as the hardcoded
 * constants did and adding a new setting never needs a data migration.
 */
export interface ISetting {
  key: string;
  value: SettingValue;
  updatedBy: Types.ObjectId | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const Setting: Model<ISetting> = model<ISetting>('Setting', settingSchema);
