import {
  EMPLOYEE_DOCUMENT_TYPES,
  type EmployeeDocumentType,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Employee document. The binary is referenced through StoredFile; this record carries
 * the HR metadata (type, validity dates, notes) that the file itself does not have.
 */
export interface IEmployeeDocument {
  employee: Types.ObjectId;
  file: Types.ObjectId;
  documentType: EmployeeDocumentType;
  name: string;
  issueDate: Date | null;
  expiryDate: Date | null;
  notes: string | null;
  uploadedBy: Types.ObjectId | null;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IEmployeeDocument>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    file: { type: Schema.Types.ObjectId, ref: 'StoredFile', required: true },
    documentType: { type: String, enum: EMPLOYEE_DOCUMENT_TYPES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    notes: { type: String, default: null, trim: true, maxlength: 1000 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedByName: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

schema.index({ employee: 1, documentType: 1, createdAt: -1 });

export const EmployeeDocument: Model<IEmployeeDocument> = model<IEmployeeDocument>(
  'EmployeeDocument',
  schema,
);
