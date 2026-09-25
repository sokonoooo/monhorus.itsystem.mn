import { Types } from 'mongoose';
import sharp from 'sharp';

import { logger } from '../../config/logger';
import { StoredFile } from '../storage/stored-file.model';
import { resolveStoredFilePath } from '../storage/storage.service';

/**
 * Turning stored photographs into something a PDF can carry.
 *
 * THE PROBLEM THIS SOLVES IS SIZE, not format. Nothing in this system has ever resized an
 * upload: a phone photograph arrives at a few thousand pixels across and several
 * megabytes, and it is stored exactly as it came. pdfmake does not resample — it embeds
 * the bytes it is given and merely scales the box they are drawn in — so a report with
 * forty photographs would be a document of a few hundred megabytes that draws each one at
 * the size of a postage stamp. The reference document is 100MB for precisely this reason.
 *
 * So every picture is re-encoded here at roughly the size it will actually be printed at,
 * which turns hundreds of megabytes into a handful.
 *
 * The second thing this solves is WEBP. Task photographs may be uploaded as WEBP, and
 * pdfmake cannot draw one at all — it would throw and take the whole export down. Passing
 * everything through the encoder makes the output JPEG whatever went in.
 */

/**
 * The widest a photograph is ever drawn in these reports, in pixels.
 *
 * A photo cell is about 116pt across. At 2x for a comfortable print density that is ~232,
 * and 600 leaves room for the single-photo blocks the template also uses, which run to
 * about 240pt. Larger buys nothing a reader can see and costs bytes linearly.
 */
const MAX_PHOTO_WIDTH = 600;

/** The letterhead is small and wide; it never needs more than this. */
const MAX_LOGO_WIDTH = 400;

/**
 * How many photographs one sub-task contributes to a report.
 *
 * The template's densest block holds four, and beyond that a block stops being a record
 * of the work and becomes an album. A task with more keeps its first four — the ones
 * taken before the rest, which is the order they were attached in.
 */
export const MAX_PHOTOS_PER_TASK = 4;

/** JPEG quality. 78 is the point where artefacts stop being visible on photographs. */
const JPEG_QUALITY = 78;

/** A picture ready to hand to pdfmake, with the shape it should be drawn at. */
export interface ReportImage {
  /** A `data:` url, which is what pdfmake accepts for an inline image. */
  dataUrl: string;
  width: number;
  height: number;
}

/** The aspect ratio, or null when the encoder could not tell us the dimensions. */
export function aspectRatio(image: ReportImage): number | null {
  return image.height > 0 ? image.width / image.height : null;
}

/**
 * Re-encodes one image file to a JPEG data url no wider than [maxWidth].
 *
 * Returns null rather than throwing on anything unreadable — a corrupt upload, a file
 * that has gone missing from disk, a format the decoder does not know. A report is still
 * a report without one of its photographs, and a failed download because one picture in
 * forty was bad is a far worse outcome than a gap.
 */
async function encode(absolutePath: string, maxWidth: number): Promise<ReportImage | null> {
  try {
    const pipeline = sharp(absolutePath, { failOn: 'none' })
      // `withoutEnlargement` so a small picture is never blown up: upscaling a 200px photo
      // to 600 adds bytes and invents detail that was never there.
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    logger.warn({ err: error, absolutePath }, 'report image skipped: could not be encoded');
    return null;
  }
}

/**
 * `.rotate()` with no argument applies the EXIF orientation and then drops the tag.
 *
 * Without it a photograph taken in portrait on a phone embeds as landscape and appears on
 * its side, because the pixels are stored rotated and only the tag says otherwise — and a
 * PDF carries no EXIF for a reader to correct it by.
 */

/** The letterhead chosen in Тохиргоо, or null when none is set or it cannot be read. */
export async function loadLogo(fileId: string): Promise<ReportImage | null> {
  if (!Types.ObjectId.isValid(fileId)) return null;

  const file = await StoredFile.findById(fileId).lean();
  if (!file) {
    logger.warn({ fileId }, 'report logo setting points at a file that no longer exists');
    return null;
  }

  return encode(resolveStoredFilePath(file.storageKey), MAX_LOGO_WIDTH);
}

/** One task's photographs, in the order they were attached. */
export interface TaskPhotos {
  taskId: string;
  images: ReportImage[];
}

/**
 * Loads and re-encodes the photographs for a set of tasks, in one pass.
 *
 * One database round trip for every file across every task rather than one per task: a
 * planned work with forty sub-tasks would otherwise open forty connections to answer the
 * same question.
 *
 * The encoding itself runs in parallel, bounded only by how many files there are. That is
 * deliberate for now — sharp releases the event loop while libvips works, these are a few
 * dozen images, and a queue would be complexity for a cost nobody has measured.
 */
export async function loadTaskPhotos(
  tasks: ReadonlyArray<{ taskId: string; fileIds: readonly string[] }>,
  perTaskLimit: number,
): Promise<Map<string, ReportImage[]>> {
  const wanted = tasks.map((task) => ({
    taskId: task.taskId,
    fileIds: task.fileIds.slice(0, perTaskLimit),
  }));

  const allIds = wanted
    .flatMap((task) => task.fileIds)
    .filter((id) => Types.ObjectId.isValid(id));
  if (allIds.length === 0) return new Map();

  const files = await StoredFile.find({ _id: { $in: allIds } })
    .select('_id storageKey')
    .lean();
  const pathById = new Map(files.map((file) => [String(file._id), file.storageKey]));

  const encoded = new Map<string, ReportImage>();
  await Promise.all(
    [...new Set(allIds)].map(async (id) => {
      const key = pathById.get(id);
      if (key === undefined) return;
      const image = await encode(resolveStoredFilePath(key), MAX_PHOTO_WIDTH);
      if (image !== null) encoded.set(id, image);
    }),
  );

  const result = new Map<string, ReportImage[]>();
  for (const task of wanted) {
    const images = task.fileIds
      .map((id) => encoded.get(id))
      .filter((image): image is ReportImage => image !== undefined);
    if (images.length > 0) result.set(task.taskId, images);
  }
  return result;
}

/**
 * What a just-uploaded logo actually is, according to the decoder rather than the header.
 *
 * Returns null when the bytes are not a raster image this renderer can draw. The upload
 * route uses this to refuse a file that would upload cleanly and then fail to appear on
 * every report — an SVG, a PDF renamed `.png`, a truncated download.
 */
export async function readLogoDimensions(
  absolutePath: string,
): Promise<{ mimeType: string; width: number; height: number } | null> {
  try {
    const meta = await sharp(absolutePath).metadata();
    const format = meta.format ?? '';
    if (format !== 'png' && format !== 'jpeg') return null;
    if (!meta.width || !meta.height) return null;
    return {
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      width: meta.width,
      height: meta.height,
    };
  } catch {
    return null;
  }
}
