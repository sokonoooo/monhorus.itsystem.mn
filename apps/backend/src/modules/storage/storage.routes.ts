import fs from 'node:fs';

import { PERMISSIONS, employeeDocumentMetaSchema, type PermissionKey } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  assertInCustomerScope,
  resolveCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { authenticate, enforcePasswordChange, requireAuth } from '../../middlewares/authenticate.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { recordAudit } from '../audit/audit.service';
import { EmployeeDocument } from '../employee/employee-document.model';
import { toEmployeeDocumentDto } from '../employee/employee.mapper';
import { Employee } from '../employee/employee.model';
import { ObjectRecord } from '../object-master/object-master.models';
import { ObjectNode } from '../objects/object.models';
import { ServiceRequest } from '../service-request/service-request.model';
import { WorkReport } from '../service-request/work-report.model';
import { StoredFile, type IStoredFile, type StoredFileOwnerType } from './stored-file.model';
import {
  acceptSvgIcon,
  deleteStoredFile,
  resolveStoredFilePath,
  upload,
  writeStoredFileBytes,
} from './storage.service';
import { sanitiseSvgIcon } from './svg-sanitiser';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

/**
 * Permissions that admit a download, by owning entity. Holding ANY of them passes the
 * guard; the tenant question is answered separately, by `assertFileInCustomerScope`.
 *
 * Exhaustive by construction: adding an owner type to the model without extending this
 * map is a compile error, so a new attachment kind can never default to being readable
 * by anyone who can guess a file id.
 *
 * The portal keys sit beside their staff counterparts rather than replacing them because
 * the two answer the same question for different populations — "may you look at floor
 * plans at all". Section "Customer self-service" in permissions.ts is explicit that a
 * portal key is necessary and never sufficient: every one of the three owner kinds below
 * that accepts a portal key is also resolved back to its customer before a byte is
 * served. `EMPLOYEE` and `PLANNED_WORK_TASK` stay staff-only — an HR document and an
 * internal work task are not customer-facing, so there is no portal key to accept.
 */
const DOWNLOAD_PERMISSIONS_BY_OWNER: Record<StoredFileOwnerType, readonly PermissionKey[]> = {
  EMPLOYEE: [PERMISSIONS.EMPLOYEE_VIEW],
  SERVICE_REQUEST: [PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW],
  PLANNED_WORK_TASK: [PERMISSIONS.PLANNED_WORK_VIEW],
  FLOOR_PLAN: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_FLOOR_VIEW],
  OBJECT: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.PORTAL_OBJECT_VIEW],
  /**
   * The same pair as `OBJECT`, and for the same reason: whoever may see a piece of
   * equipment may see the glyph drawn on top of it.
   *
   * The portal key is not generosity. `GET /objects` accepts `portal.object.view` and
   * every row it returns inlines `objectType.iconUrl`, so a customer is HANDED these urls
   * by the endpoint they are entitled to call. Refusing them here would not withhold
   * anything — the icon is global and describes a catalogue entry, not a tenant — it would
   * only render a broken image on the one screen the field exists for. That is exactly the
   * shape of the floor-plan bug the portal keys above were added to fix.
   */
  OBJECT_TYPE: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.PORTAL_OBJECT_VIEW],
};

/**
 * Response headers for a served SVG, and the reason they are written here by hand.
 *
 * An SVG is a document, not a picture: opened at its own url it is a browsing context that
 * can carry script. Everything served by this route is sanitised before storage, so this is
 * the SECOND layer — the one that has to hold when the first is wrong.
 *
 * It is spelled out rather than inherited because what protects the application today is
 * `helmet()`'s default `script-src 'self'`, which nobody chose for this and no test pins.
 * A future decision to relax the app-wide policy — a CDN, an analytics snippet, an inline
 * bootstrap — would silently widen what an SVG served from this origin may do. These
 * headers are attached to the SVG response itself and are pinned by a test, so that can no
 * longer happen quietly.
 *
 *   default-src 'none'  — no script, no fetch, no font, no frame, no image, nothing. An
 *                         icon needs to fetch precisely nothing, so the budget is zero.
 *   style-src 'unsafe-inline'
 *                       — the single exception. A sanitised icon legitimately carries its
 *                         colours in `style="…"` and in a `<style>` block (that is how
 *                         every Illustrator export stores them), and both count as inline
 *                         styles. It grants no script: CSS cannot execute, and the
 *                         constructs that historically blurred that line — `expression()`,
 *                         `-moz-binding`, `@import`, `url()` — are removed by the
 *                         sanitiser before the bytes are ever written.
 *   sandbox             — with no tokens, i.e. maximally restrictive. Drops the document
 *                         into a unique opaque origin with scripting, forms, popups,
 *                         top-level navigation and same-origin access all denied. Costs
 *                         nothing when the file is drawn through `<img>` (already
 *                         script-free) and is what matters when somebody opens the url
 *                         directly.
 */
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Resolves a file back to the organisation that owns it and refuses a caller outside it.
 *
 * The permission answers "may you look at this module"; this answers "at whose records".
 * Without it a portal key would be a master key: this route is keyed on the file id alone,
 * so one customer holding `portal.floor.view` could read every other tenant's floor plan
 * by guessing 24 hex characters.
 *
 * A no-op for staff — `resolveCustomerScope` returns a STAFF scope and `assertInCustomerScope`
 * permits everything — so cross-tenant staff access is exactly what it was.
 *
 * The two staff-only owner kinds are refused outright rather than left to fall through.
 * They are unreachable today because the guard above admits no portal key for them, but a
 * customer arriving here at all would mean a permission was granted that never should have
 * been, and the safe answer to that is no.
 *
 * Reported as not-found, matching every other customer-scoped read: a forbidden reply for
 * an id that exists in another tenant confirms the file is real.
 */
/**
 * The customer who owns a conclusion's before/after photo, or null.
 *
 * A SERVICE_REQUEST-owned file is normally resolved through `ServiceRequest.findById(ownerId)`,
 * because `createServiceRequest` re-owns an attachment onto the request that claims it. A
 * CONCLUSION PHOTO IS NEVER RE-OWNED: `POST /files/work-report-photos` parks it on the
 * uploading technician's user id and `saveWorkReport` only stores the id in `beforePhotos` /
 * `afterPhotos`, so `ownerId` stays a user forever. That id matches no request, so the
 * lookup above returns nothing and the customer read was refused — the conclusion's own
 * endpoint would hand a customer photo urls that every one of them 404'd.
 *
 * Re-owning the files on save would have fixed the shape and left every photo already in the
 * database still broken, so the resolution is widened instead: a file no request claims is
 * looked up through the conclusion that references it.
 *
 * ONLY AN APPROVED CONCLUSION COUNTS, matching `getCustomerWorkReport` exactly. The two must
 * not drift: a customer who could fetch the evidence attached to a draft would be reading a
 * conclusion nobody has signed off, one file at a time, while the endpoint that serves it
 * still answered 404. Staff never reach this — `assertFileInCustomerScope` returns early for
 * a STAFF scope — so a technician's access to their own draft's photos is untouched.
 *
 * `objectAssessments[].photos` is deliberately NOT matched. Per-equipment evidence is not on
 * `CustomerWorkReportDto`, so no customer is ever handed one of those ids, and widening to
 * cover them would grant access nothing asks for.
 */
async function customerOfWorkReportPhoto(fileId: Types.ObjectId): Promise<Types.ObjectId | null> {
  const report = await WorkReport.findOne({
    status: 'APPROVED',
    $or: [{ beforePhotos: fileId }, { afterPhotos: fileId }],
  }).select('serviceRequest');
  if (!report) return null;

  const serviceRequest = await ServiceRequest.findById(report.serviceRequest).select('customer');
  return serviceRequest?.customer ?? null;
}

async function assertFileInCustomerScope(
  auth: AuthContext,
  file: Pick<IStoredFile, 'ownerType' | 'ownerId'> & { _id: Types.ObjectId },
): Promise<void> {
  const scope = resolveCustomerScope(auth);
  if (scope.mode === 'STAFF') return;

  const notFound = 'Файл олдсонгүй.';

  switch (file.ownerType) {
    case 'FLOOR_PLAN': {
      // `uploadFloorPlan` parks the image on the floor node itself, so the owner id is
      // the floor and its denormalised `customer` is the answer.
      const floor = await ObjectNode.findById(file.ownerId).select('customer kind');
      assertInCustomerScope(scope, floor?.kind === 'FLOOR' ? floor.customer : null, notFound);
      return;
    }
    case 'OBJECT': {
      // Assessment evidence is parked on the uploader until an assessment claims it for
      // the object. An unclaimed file resolves to no object and is therefore refused.
      const object = await ObjectRecord.findById(file.ownerId).select('customer');
      assertInCustomerScope(scope, object?.customer, notFound);
      return;
    }
    case 'SERVICE_REQUEST': {
      // Same shape: an attachment is parked on the uploader until the request claims it.
      const serviceRequest = await ServiceRequest.findById(file.ownerId).select('customer');
      if (serviceRequest) {
        assertInCustomerScope(scope, serviceRequest.customer, notFound);
        return;
      }

      // No request claimed it. Either it is a conclusion photo, which is never re-owned, or
      // it is an attachment still parked on its uploader — and the second resolves to null
      // here exactly as it did before, so an unclaimed upload stays unreadable.
      assertInCustomerScope(scope, await customerOfWorkReportPhoto(file._id), notFound);
      return;
    }
    case 'OBJECT_TYPE': {
      // DELIBERATE, NOT AN OVERSIGHT. There is no tenant to check. The equipment-type
      // registry is a single global catalogue — `IObjectType` has no `customer` field, and
      // an object type is not created within an organisation — so a custom icon on one
      // resolves to no customer and never could. Falling through to the refusal below
      // would not be "safe by default": it would 403 the icon of the type a customer's own
      // equipment already declares, on the strength of tenancy the asset does not have.
      //
      // What keeps this narrow is that the file describes a catalogue entry and nothing
      // else: no customer name, no site, no count, no equipment. The permission check above
      // has already established the caller may look at equipment types at all, and this
      // route is reached only with a file id that some object list handed out.
      //
      // The moment an icon becomes per-customer, this case must become a real check.
      return;
    }
    default:
      throw AppError.forbidden();
  }
}

/**
 * The one exception to the table above: a caller may fetch the photo on their OWN employee
 * card without `employee.view`.
 *
 * `GET /employees/me` returns `photoUrl`, and a technician no longer holds `employee.view` —
 * without this the profile screen would render a broken image for every field employee in
 * the company, and the obvious "fix" would be to hand the directory permission back, which
 * is the leak this whole change removes.
 *
 * Kept as narrow as it can be made. It is not "EMPLOYEE-owned files belonging to me": that
 * would open the caller's own uploaded HR documents — contracts, diplomas, scans — which are
 * keyed on `employee.manage_documents` for a reason. The match is against
 * `Employee.photoDocument` specifically, on the employee id the authenticate middleware
 * resolved from the account, so the query is `{ _id: <my employee>, photoDocument: <this
 * file> }` and cannot be steered by the request.
 *
 * Only reached when the ordinary permission check has already failed, so it costs a query
 * for exactly the callers that need it.
 */
async function isOwnProfilePhoto(
  auth: { employeeId: string | null },
  file: { _id: Types.ObjectId; ownerType: StoredFileOwnerType },
): Promise<boolean> {
  if (file.ownerType !== 'EMPLOYEE' || !auth.employeeId) return false;

  const own = await Employee.exists({ _id: auth.employeeId, photoDocument: file._id });
  return own !== null;
}

export const fileRouter = Router();

fileRouter.use(authenticate, enforcePasswordChange);

/**
 * Authenticated download. The permission required depends on the owning entity, so a
 * caller who may not view employees cannot read an employee's documents by guessing
 * a file id, and the owning entity is then resolved back to its organisation so a
 * customer cannot read another tenant's file by guessing one either.
 */
fileRouter.get(
  '/:fileId',
  validate({ params: z.object({ fileId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const file = await StoredFile.findById(pathParam(req, 'fileId'));
      if (!file) {
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Файл олдсонгүй.');
      }

      const accepted = DOWNLOAD_PERMISSIONS_BY_OWNER[file.ownerType];
      const permitted = accepted.some((key) => auth.permissions.has(key));

      if (!permitted && !(await isOwnProfilePhoto(auth, file))) {
        throw AppError.forbidden();
      }

      // The guard above says the caller may look at this kind of file; this says whose.
      await assertFileInCustomerScope(auth, file);

      const absolutePath = resolveStoredFilePath(file.storageKey);
      if (!fs.existsSync(absolutePath)) {
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Файл серверт олдсонгүй.');
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', String(file.sizeBytes));
      // Never let a browser second-guess the declared type. A stored file's `mimeType` is
      // what the server decided it is; sniffing could promote something to a type this
      // route never intended to serve.
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // An SVG is the one image that is also a document. Locked down explicitly rather than
      // left to the app-wide helmet default — see SVG_CONTENT_SECURITY_POLICY.
      if (file.mimeType === 'image/svg+xml') {
        res.setHeader('Content-Security-Policy', SVG_CONTENT_SECURITY_POLICY);
      }

      // Inline for images so the photo renders; attachment otherwise.
      const disposition = file.mimeType.startsWith('image/') ? 'inline' : 'attachment';
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      // Private files must never be cached by an intermediary.
      res.setHeader('Cache-Control', 'private, no-store');

      fs.createReadStream(absolutePath).pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Uploads an attachment before the request exists.
 *
 * The create form needs file ids to put in `attachmentIds`, so an upload has no
 * request to belong to yet. The file is parked against the uploader's own id and
 * claimed by the request on creation. Access still requires service_request.view,
 * and an unclaimed file is only reachable by a caller with that permission.
 *
 * The portal key sits beside the staff one for the same reason it does on
 * `POST /service-requests`: a customer who may raise a request must be able to
 * photograph what they are raising it about. Without it the two halves of one form
 * disagreed — the request was accepted and the picture was 403'd — which is why the
 * customer app shipped with no photo field at all.
 *
 * Accepting a portal key here opens no cross-tenant door, because this route writes
 * rather than reads and everything it writes is keyed on the caller:
 *
 *   * `ownerId` and `uploadedBy` are taken from the authenticated session, never from
 *     the request, so an upload can only ever be parked on the caller themselves.
 *   * The file is not readable by the uploader either until a request claims it —
 *     `assertFileInCustomerScope` resolves a SERVICE_REQUEST file through
 *     `ServiceRequest.findById(ownerId)`, and a parked file's owner is a user id, which
 *     matches no request and is therefore refused.
 *   * `createServiceRequest` only claims files this same account uploaded, so the id
 *     minted here cannot be handed to another tenant's request either.
 *
 * There is consequently no scope question to ask at upload time: the permission asks
 * "may you attach files at all", and there is no "whose records" until the request
 * that claims the file names them.
 */
fileRouter.post(
  '/service-request-attachments',
  requireAnyPermission(
    PERMISSIONS.SERVICE_REQUEST_CREATE,
    PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE,
  ),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'Файл сонгоно уу.' },
        ]);
      }

      const storedFile = await StoredFile.create({
        storageKey: uploaded.filename,
        originalName: uploaded.originalname,
        mimeType: uploaded.mimetype,
        sizeBytes: uploaded.size,
        ownerType: 'SERVICE_REQUEST',
        // Parked on the uploader until a request claims it.
        ownerId: new Types.ObjectId(auth.userId),
        uploadedBy: new Types.ObjectId(auth.userId),
        uploadedByName: auth.fullName,
      });

      created(
        res,
        {
          id: String(storedFile._id),
          name: storedFile.originalName,
          downloadUrl: `/api/v1/files/${String(storedFile._id)}`,
          mimeType: storedFile.mimeType,
          sizeBytes: storedFile.sizeBytes,
          uploadedByName: storedFile.uploadedByName,
          uploadedAt: storedFile.createdAt.toISOString(),
        },
        'Файл хуулагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Uploads assessment evidence before the assessment exists.
 *
 * An assessment is written in one shot with its `photoIds`, so the picture has no
 * assessment to belong to at upload time. The file is parked against the uploader's own
 * id exactly as a service-request attachment is, and `recordAssessment` transfers
 * ownership to the object once the entry is written. Access still requires
 * object_master.view, so an unclaimed file is no more readable than a claimed one.
 */
fileRouter.post(
  '/object-assessment-photos',
  requirePermission(PERMISSIONS.OBJECT_MASTER_ASSESS),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'Зураг сонгоно уу.' },
        ]);
      }

      // Evidence is photographic: a document proves nothing about what was seen.
      if (!uploaded.mimetype.startsWith('image/')) {
        deleteStoredFile(uploaded.filename);
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Зөвхөн зураг хавсаргана.', [
          { field: 'file', message: 'Зургийн файл сонгоно уу.' },
        ]);
      }

      const storedFile = await StoredFile.create({
        storageKey: uploaded.filename,
        originalName: uploaded.originalname,
        mimeType: uploaded.mimetype,
        sizeBytes: uploaded.size,
        ownerType: 'OBJECT',
        // Parked on the uploader until an assessment claims it.
        ownerId: new Types.ObjectId(auth.userId),
        uploadedBy: new Types.ObjectId(auth.userId),
        uploadedByName: auth.fullName,
      });

      created(
        res,
        {
          id: String(storedFile._id),
          name: storedFile.originalName,
          downloadUrl: `/api/v1/files/${String(storedFile._id)}`,
          mimeType: storedFile.mimeType,
          sizeBytes: storedFile.sizeBytes,
          uploadedByName: storedFile.uploadedByName,
          uploadedAt: storedFile.createdAt.toISOString(),
        },
        'Зураг хуулагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Uploads before/after evidence for a service request's section 9.2 conclusion.
 *
 * `saveWorkReport` writes the whole conclusion in one shot from `beforePhotoIds` and
 * `afterPhotoIds`, so the picture has no report to belong to at upload time. It is parked
 * against the uploader exactly as an assessment photo is, and the report claims it on save.
 *
 * `SERVICE_REQUEST` rather than a new owner kind: the download route already maps that kind
 * to `service_request.view`, which is precisely who may look at a request's evidence, and
 * the request's own attachments are already parked the same way.
 *
 * The gate is `service_request.update`, matching PUT /service-requests/:requestId/report —
 * whoever may write the conclusion may attach its evidence, and nobody else.
 */
fileRouter.post(
  '/work-report-photos',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_UPDATE),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'Зураг сонгоно уу.' },
        ]);
      }

      // Evidence is photographic: a document proves nothing about what was done.
      if (!uploaded.mimetype.startsWith('image/')) {
        deleteStoredFile(uploaded.filename);
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Зөвхөн зураг хавсаргана.', [
          { field: 'file', message: 'Зургийн файл сонгоно уу.' },
        ]);
      }

      const storedFile = await StoredFile.create({
        storageKey: uploaded.filename,
        originalName: uploaded.originalname,
        mimeType: uploaded.mimetype,
        sizeBytes: uploaded.size,
        ownerType: 'SERVICE_REQUEST',
        // Parked on the uploader until the conclusion claims it.
        ownerId: new Types.ObjectId(auth.userId),
        uploadedBy: new Types.ObjectId(auth.userId),
        uploadedByName: auth.fullName,
      });

      created(
        res,
        {
          id: String(storedFile._id),
          name: storedFile.originalName,
          downloadUrl: `/api/v1/files/${String(storedFile._id)}`,
          mimeType: storedFile.mimeType,
          sizeBytes: storedFile.sizeBytes,
          uploadedByName: storedFile.uploadedByName,
          uploadedAt: storedFile.createdAt.toISOString(),
        },
        'Зураг хуулагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Uploads a custom SVG icon for an equipment type, before the type exists.
 *
 * Same parked-then-claimed shape as every other pre-entity upload here: the create form
 * needs a file id to put in `iconFileId`, so the file is owned to the uploader and
 * `createObjectType` / `updateObjectType` re-own it onto the type that claims it.
 *
 * Gated on `object_type.manage`, matching POST and PATCH /object-types exactly — whoever
 * may create or edit a type may give it a picture, and nobody else. `object_master.view`
 * is not enough: that is the permission to LOOK at the registry.
 *
 * THREE THINGS HAPPEN BEFORE A BYTE IS STORED, in this order:
 *
 *   1. `acceptSvgIcon` caps the request at 64 KB and rejects a content type that is not
 *      `image/svg+xml`, buffering into memory so nothing unclean ever reaches the disk.
 *   2. `sanitiseSvgIcon` PARSES the bytes. This is what actually establishes the file is an
 *      SVG — the declared content type is a claim, not evidence — so a PNG renamed
 *      `icon.svg` and posted as `image/svg+xml` is refused here, not accepted here.
 *   3. Only the parser's own output is written, under a server-generated key.
 *
 * The stored `sizeBytes` is therefore the size of the CLEAN file, not of what was sent.
 */
fileRouter.post(
  '/object-type-icons',
  requirePermission(PERMISSIONS.OBJECT_TYPE_MANAGE),
  acceptSvgIcon,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'SVG файл сонгоно уу.' },
        ]);
      }

      // Throws a 400 when the content is not really an SVG. Hostile content inside a
      // genuine one is not an error — it is simply not in the result.
      const sanitised = sanitiseSvgIcon(uploaded.buffer);
      const bytes = Buffer.byteLength(sanitised, 'utf8');

      const storedFile = await StoredFile.create({
        storageKey: writeStoredFileBytes(sanitised),
        // Display metadata only; it never touches the filesystem, and the extension is
        // pinned because what was stored is an SVG regardless of what it arrived called.
        originalName: `${uploaded.originalname.replace(/\.[^.]*$/, '').slice(0, 80) || 'icon'}.svg`,
        mimeType: 'image/svg+xml',
        sizeBytes: bytes,
        ownerType: 'OBJECT_TYPE',
        // Parked on the uploader until an object type claims it.
        ownerId: new Types.ObjectId(auth.userId),
        uploadedBy: new Types.ObjectId(auth.userId),
        uploadedByName: auth.fullName,
      });

      created(
        res,
        {
          id: String(storedFile._id),
          name: storedFile.originalName,
          downloadUrl: `/api/v1/files/${String(storedFile._id)}`,
          mimeType: storedFile.mimeType,
          sizeBytes: storedFile.sizeBytes,
          uploadedByName: storedFile.uploadedByName,
          uploadedAt: storedFile.createdAt.toISOString(),
        },
        'Айкон хуулагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);

// -- Employee documents ------------------------------------------------------

export const employeeDocumentRouter = Router({ mergeParams: true });

employeeDocumentRouter.use(authenticate, enforcePasswordChange);

employeeDocumentRouter.get(
  '/',
  requirePermission(PERMISSIONS.EMPLOYEE_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const documents = await EmployeeDocument.find({
        employee: new Types.ObjectId(pathParam(req, 'employeeId')),
      })
        .populate({ path: 'file', select: 'mimeType sizeBytes' })
        .sort({ createdAt: -1 });

      ok(res, documents.map(toEmployeeDocumentDto));
    } catch (error) {
      next(error);
    }
  },
);

employeeDocumentRouter.post(
  '/',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_DOCUMENTS),
  upload.single('file'),
  validate({ body: employeeDocumentMetaSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'Файл сонгоно уу.' },
        ]);
      }

      const employee = await Employee.findById(pathParam(req, 'employeeId')).select('_id');
      if (!employee) {
        deleteStoredFile(uploaded.filename);
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
      }

      const storedFile = await StoredFile.create({
        storageKey: uploaded.filename,
        originalName: uploaded.originalname,
        mimeType: uploaded.mimetype,
        sizeBytes: uploaded.size,
        ownerType: 'EMPLOYEE',
        ownerId: employee._id,
        uploadedBy: new Types.ObjectId(auth.userId),
        uploadedByName: auth.fullName,
      });

      const document = await EmployeeDocument.create({
        employee: employee._id,
        file: storedFile._id,
        documentType: req.body.documentType,
        name: req.body.name,
        issueDate: req.body.issueDate ? new Date(req.body.issueDate) : null,
        expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
        notes: req.body.notes ?? null,
        uploadedBy: new Types.ObjectId(auth.userId),
        uploadedByName: auth.fullName,
      });

      // The photo document type also becomes the employee's avatar.
      if (req.body.documentType === 'PHOTO') {
        await Employee.updateOne(
          { _id: employee._id },
          { $set: { photoDocument: storedFile._id } },
        );
      }

      await recordAudit({
        entityType: 'Employee',
        entityId: employee._id,
        action: 'Updated',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        reason: 'document uploaded',
        newValue: { documentType: req.body.documentType, name: req.body.name },
      });

      const populated = await EmployeeDocument.findById(document._id).populate({
        path: 'file',
        select: 'mimeType sizeBytes',
      });

      created(res, populated ? toEmployeeDocumentDto(populated) : null, 'Баримт хадгалагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

employeeDocumentRouter.delete(
  '/:documentId',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_DOCUMENTS),
  validate({ params: z.object({ employeeId: objectId, documentId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const document = await EmployeeDocument.findOne({
        _id: new Types.ObjectId(pathParam(req, 'documentId')),
        // Scoped by employee so a document cannot be deleted via a mismatched parent.
        employee: new Types.ObjectId(pathParam(req, 'employeeId')),
      });
      if (!document) {
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Баримт олдсонгүй.');
      }

      const storedFile = await StoredFile.findById(document.file);
      if (storedFile) {
        deleteStoredFile(storedFile.storageKey);
        await StoredFile.deleteOne({ _id: storedFile._id });
      }

      await EmployeeDocument.deleteOne({ _id: document._id });
      await Employee.updateOne(
        { _id: document.employee, photoDocument: document.file },
        { $set: { photoDocument: null } },
      );

      await recordAudit({
        entityType: 'Employee',
        entityId: document.employee,
        action: 'Updated',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        reason: 'document removed',
        oldValue: { documentType: document.documentType, name: document.name },
      });

      ok(res, { id: String(document._id) }, 'Баримт устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);
