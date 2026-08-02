import { Schema, model, type Model } from 'mongoose';

/**
 * Atomic named sequence.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` is a single atomic document operation, so
 * two concurrent callers always receive different values. This is stronger than
 * deriving the next number by counting existing documents, which can hand the same
 * number to two concurrent writers and rely on a unique-index collision plus a retry.
 */
export interface ICounter {
  /** Scope key, for example "planned-work:202607". */
  key: string;
  value: number;
}

const counterSchema = new Schema<ICounter>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter: Model<ICounter> = model<ICounter>('Counter', counterSchema);

/** Returns the next value for `key`, starting at 1. */
export async function nextSequenceValue(key: string): Promise<number> {
  const updated = await Counter.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  // `new: true` with upsert always returns a document; the fallback keeps the
  // signature total rather than asserting non-null.
  return updated?.value ?? 1;
}
