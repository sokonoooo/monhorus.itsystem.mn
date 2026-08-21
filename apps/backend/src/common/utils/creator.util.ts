import { Types } from 'mongoose';

/**
 * Reading a creator's display name off a list row.
 *
 * Two storage shapes exist in this codebase and both have to be served from one place.
 * The older modules denormalise the name at write time into a `createdByName` column beside
 * the `createdBy` reference; the rest store only the reference. Rather than migrate one into
 * the other, list queries populate `createdBy` with `fullName` and the DTO mapper calls this,
 * which prefers the denormalised string when it is there and falls back to the populated
 * document when it is not.
 *
 * Why the denormalised value wins: it is what the name WAS when the record was created. A
 * populated join reports what the user is called today, so a renamed or since-deleted
 * account would silently rewrite history on old rows. Where both exist, the stamp is the
 * truthful one.
 *
 * Returns null rather than a placeholder. What to show for an unknown creator is a decision
 * for the screen — records that predate creator tracking legitimately have no answer, and
 * the web app renders those as a dash.
 */
export function creatorName(
  populated: unknown,
  denormalised?: string | null,
): string | null {
  if (denormalised) return denormalised;

  // An unpopulated ref arrives as an ObjectId; there is no name to be had from it.
  if (!populated || populated instanceof Types.ObjectId) return null;
  if (typeof populated !== 'object') return null;

  const { fullName } = populated as { fullName?: unknown };
  return typeof fullName === 'string' && fullName.length > 0 ? fullName : null;
}

/** What every list query passes to `.populate()` to make the above resolvable. */
export const CREATOR_POPULATE = { path: 'createdBy', select: 'fullName' } as const;
