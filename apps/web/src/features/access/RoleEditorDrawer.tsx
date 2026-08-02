import {
  createRoleSchema,
  updateRoleSchema,
  type PermissionKey,
  type RoleDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { rbacService, type PermissionCatalogueEntry } from '../../services/rbac.service';
import { Field, TextInput } from '../employees/FormControls';
import { PermissionPicker } from './PermissionPicker';

interface RoleEditorDrawerProps {
  /** A role to edit, the literal 'new' to create, or null when closed. */
  role: RoleDto | null | 'new';
  catalogue: readonly PermissionCatalogueEntry[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create and edit a dynamic role.
 *
 * A system role keeps its key and cannot be deleted, but its permission set stays
 * editable, which is what makes the seeded defaults adjustable at runtime. The backend
 * enforces the key immutability; the field is simply disabled here.
 */
export function RoleEditorDrawer({
  role,
  catalogue,
  readOnly,
  onClose,
  onSaved,
}: RoleEditorDrawerProps): ReactElement {
  const { notify } = useToast();

  const isNew = role === 'new';
  const existing = role !== null && role !== 'new' ? role : null;

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (role === null) return;

    if (existing) {
      setKey(existing.key);
      setName(existing.name);
      setDescription(existing.description ?? '');
      setPermissions([...existing.permissions]);
    } else {
      setKey('');
      setName('');
      setDescription('');
      setPermissions([]);
    }
    setFormError(null);
    setFieldErrors({});
  }, [role, existing]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = isNew
      ? createRoleSchema.safeParse({
          key: key.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || null,
          permissions,
        })
      : updateRoleSchema.safeParse({
          name: name.trim(),
          description: description.trim() || null,
          permissions,
        });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.') || '_';
        if (!errors[path]) errors[path] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      if (isNew) {
        await rbacService.createRole(parsed.data as Parameters<typeof rbacService.createRole>[0]);
        notify('Role амжилттай үүслээ.', 'success');
      } else if (existing) {
        await rbacService.updateRole(
          existing.id,
          parsed.data as Parameters<typeof rbacService.updateRole>[1],
        );
        notify('Role шинэчлэгдлээ.', 'success');
      }
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const title = isNew ? 'Шинэ role' : existing ? `${existing.name}` : '';

  return (
    <Drawer
      open={role !== null}
      title={title}
      onClose={onClose}
      width="lg"
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>
            Хаах
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleSubmit()} loading={submitting}>
              Хадгалах
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {existing?.isSystem && (
          <Alert variant="warning">
            Системийн role. Key болон устгах үйлдэл хамгаалагдсан, permission-г засаж
            болно.
          </Alert>
        )}

        {readOnly && <Alert variant="info">Танд зөвхөн харах эрх байна.</Alert>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Key" required={isNew} error={fieldErrors.key} hint="Том үсэг, тоо, доогуур зураас">
            <TextInput
              value={key}
              onChange={(value) => setKey(value.toUpperCase())}
              disabled={submitting || readOnly || !isNew}
            />
          </Field>
          <Field label="Нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting || readOnly} />
          </Field>
        </div>

        <Field label="Тайлбар" error={fieldErrors.description}>
          <TextInput value={description} onChange={setDescription} disabled={submitting || readOnly} />
        </Field>

        <div>
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Permission ({permissions.length} сонгогдсон)
          </p>
          {fieldErrors.permissions && (
            <p className="mb-2 text-xs text-red-600">{fieldErrors.permissions}</p>
          )}
          <PermissionPicker
            catalogue={catalogue}
            selected={permissions}
            onChange={setPermissions}
            disabled={submitting || readOnly}
          />
        </div>
      </div>
    </Drawer>
  );
}
