import {
  EMPLOYEE_DOCUMENT_TYPES,
  EMPLOYEE_DOCUMENT_TYPE_LABELS,
  PERMISSIONS,
  type EmployeeDocumentDto,
  type EmployeeDocumentType,
} from '@monhorus/shared';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { Field, SelectInput, TextInput } from './FormControls';

/** Mirrors the backend allow-list so an unsupported file is rejected before upload. */
const ACCEPTED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const MAX_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmployeeDocumentsPanel({ employeeId }: { employeeId: string }): ReactElement {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.EMPLOYEE_MANAGE_DOCUMENTS);

  const [documents, setDocuments] = useState<EmployeeDocumentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [documentType, setDocumentType] = useState<EmployeeDocumentType>('ID_COPY');
  const [name, setName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    employeeService
      .documents(employeeId)
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Баримт ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  function handleFileChange(selected: File | null): void {
    setUploadError(null);

    if (!selected) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_MIME.includes(selected.type)) {
      setUploadError('Зөвшөөрөгдөөгүй файлын төрөл. Зураг, PDF, Word, Excel файл оруулна уу.');
      setFile(null);
      return;
    }
    if (selected.size > MAX_BYTES) {
      setUploadError(`Файлын хэмжээ ${formatSize(MAX_BYTES)}-аас их байж болохгүй.`);
      setFile(null);
      return;
    }

    setFile(selected);
    if (!name) setName(selected.name);
  }

  async function handleUpload(): Promise<void> {
    setUploadError(null);

    if (!file) {
      setUploadError('Файл сонгоно уу.');
      return;
    }
    if (!name.trim()) {
      setUploadError('Баримтын нэр заавал.');
      return;
    }

    const form = new FormData();
    form.append('file', file);
    form.append('documentType', documentType);
    form.append('name', name.trim());
    if (expiryDate) form.append('expiryDate', expiryDate);

    setUploading(true);
    try {
      const created = await employeeService.uploadDocument(employeeId, form);
      setDocuments((previous) => [created, ...previous]);
      setFile(null);
      setName('');
      setExpiryDate('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (caught) {
      setUploadError(caught instanceof ApiError ? caught.message : 'Файл хуулж чадсангүй.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(document: EmployeeDocumentDto): Promise<void> {
    if (!window.confirm(`"${document.name}" баримтыг устгах уу?`)) return;

    try {
      await employeeService.deleteDocument(employeeId, document.id);
      setDocuments((previous) => previous.filter((entry) => entry.id !== document.id));
    } catch (caught) {
      setUploadError(caught instanceof ApiError ? caught.message : 'Баримт устгаж чадсангүй.');
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <Alert variant="error">{error}</Alert>;

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="mb-2 text-xs font-semibold text-slate-700">Шинэ баримт хавсаргах</p>
          {uploadError && (
            <div className="mb-2">
              <Alert variant="error">{uploadError}</Alert>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Баримтын төрөл" required>
              <SelectInput
                value={documentType}
                onChange={(value) => setDocumentType(value as EmployeeDocumentType)}
                options={EMPLOYEE_DOCUMENT_TYPES.map((type) => ({
                  value: type,
                  label: EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
                }))}
                disabled={uploading}
              />
            </Field>
            <Field label="Баримтын нэр" required>
              <TextInput value={name} onChange={setName} disabled={uploading} />
            </Field>
            <Field label="Дуусах огноо">
              <TextInput type="date" value={expiryDate} onChange={setExpiryDate} disabled={uploading} />
            </Field>
            <Field label="Файл" required hint={`Дээд тал нь ${formatSize(MAX_BYTES)}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_MIME.join(',')}
                disabled={uploading}
                onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-200 file:px-2 file:py-1 file:text-xs file:font-medium"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button size="sm" onClick={() => void handleUpload()} loading={uploading} disabled={!file}>
              Хавсаргах
            </Button>
          </div>
        </div>
      )}

      {documents.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Хавсаргасан баримт байхгүй байна.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{document.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {EMPLOYEE_DOCUMENT_TYPE_LABELS[document.documentType]} ·{' '}
                  {formatSize(document.sizeBytes)}
                  {document.expiryDate ? ` · Дуусах: ${document.expiryDate.slice(0, 10)}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {document.isExpired && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
                    Хугацаа дууссан
                  </span>
                )}
                {/* Authenticated route; the browser sends the session on same-origin. */}
                <a
                  href={document.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                >
                  Татах
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(document)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Устгах
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
