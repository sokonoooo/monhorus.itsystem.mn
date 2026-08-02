import fs from 'node:fs';

import { PERMISSIONS, employeeDocumentMetaSchema, type PermissionKey } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { authenticate, enforcePasswordChange, requireAuth } from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { recordAudit } from '../audit/audit.service';
import { EmployeeDocument } from '../employee/employee-document.model';
import { toEmployeeDocumentDto } from '../employee/employee.mapper';
import { Employee } from '../employee/employee.model';
import { StoredFile, type StoredFileOwnerType } from './stored-file.model';
import { deleteStoredFile, resolveStoredFilePath, upload } from './storage.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

/**
 * Permission required to download a file, by owning entity.
 *
 * Exhaustive by construction: adding an owner type to the model without extending this
 * map is a compile error, so a new attachment kind can never default to being readable
 * by anyone who can guess a file id.
 */
const DOWNLOAD_PERMISSION_BY_OWNER: Record<StoredFileOwnerType, PermissionKey> = {
  EMPLOYEE: PERMISSIONS.EMPLOYEE_VIEW,
  SERVICE_REQUEST: PERMISSIONS.SERVICE_REQUEST_VIEW,
  PLANNED_WORK_TASK: PERMISSIONS.PLANNED_WORK_VIEW,
  FLOOR_PLAN: PERMISSIONS.OBJECT_VIEW,
  OBJECT: PERMISSIONS.OBJECT_MASTER_VIEW,
};

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
 * a file id.
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

      const requiredPermission = DOWNLOAD_PERMISSION_BY_OWNER[file.ownerType];

      if (!auth.permissions.has(requiredPermission) && !(await isOwnProfilePhoto(auth, file))) {
        throw AppError.forbidden();
      }

      const absolutePath = resolveStoredFilePath(file.storageKey);
      if (!fs.existsSync(absolutePath)) {
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Файл серверт олдсонгүй.');
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', String(file.sizeBytes));
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
 */
fileRouter.post(
  '/service-request-attachments',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_CREATE),
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
