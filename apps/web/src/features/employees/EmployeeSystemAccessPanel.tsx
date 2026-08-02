import {
  ACCOUNT_STATUS_LABELS,
  PERMISSIONS,
  USER_ROLES,
  USER_ROLE_LABELS,
  canManageRole,
  linkSystemAccessSchema,
  type EmployeeSystemAccessDto,
  type RoleDto,
  type UserDto,
  type UserRole,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { rbacService } from '../../services/rbac.service';
import { ResetPasscodeModal, type PasscodeResetTarget } from '../users/ResetPasscodeModal';
import { Field, SelectInput, TextInput } from './FormControls';

type LifecycleAction = 'suspend' | 'restore' | 'revoke';

const LIFECYCLE_COPY: Record<
  LifecycleAction,
  { title: string; message: string; confirmLabel: string; danger: boolean; success: string }
> = {
  suspend: {
    title: 'Системийн эрх түр хаах',
    message:
      'Энэ ажилтны нэвтрэх эрхийг түр хаах уу? Нээлттэй сесс тэр даруй тасарна. Бүртгэл болон түүх хэвээр үлдэнэ.',
    confirmLabel: 'Тийм, түр хаах',
    danger: true,
    success: 'Системийн эрх түр хаагдлаа.',
  },
  restore: {
    title: 'Системийн эрх сэргээх',
    message: 'Түр хаагдсан нэвтрэх эрхийг сэргээх үү? Ажилтан дахин нэвтрэх боломжтой болно.',
    confirmLabel: 'Тийм, сэргээх',
    danger: false,
    success: 'Системийн эрх сэргээгдлээ.',
  },
  revoke: {
    title: 'Системийн эрх хүчингүй болгох',
    message:
      'Нэвтрэх эрхийг бүрмөсөн хүчингүй болгож, ажилтнаас салгах уу? Ажилтны бүртгэл болон үйлдлийн түүх устахгүй.',
    confirmLabel: 'Тийм, хүчингүй болгох',
    danger: true,
    success: 'Системийн эрх хүчингүй боллоо.',
  },
};

function Row({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-slate-900">{value ?? '-'}</span>
    </div>
  );
}

function RoleChecklist({
  roles,
  selected,
  onToggle,
  disabled,
}: {
  roles: RoleDto[];
  selected: readonly string[];
  onToggle: (roleId: string) => void;
  disabled: boolean;
}): ReactElement {
  if (roles.length === 0) {
    return <p className="text-sm text-slate-500">Сонгох role байхгүй байна.</p>;
  }

  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg ring-1 ring-slate-200 p-2">
      {roles.map((role) => (
        <li key={role.id}>
          <label className="flex items-start gap-2 rounded p-1 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.includes(role.id)}
              disabled={disabled}
              onChange={() => onToggle(role.id)}
            />
            <span className="min-w-0">
              <span className="block text-slate-900">{role.name}</span>
              <span className="block text-xs text-slate-500">{role.key}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * System access section of the employee detail screen.
 *
 * Covers the whole lifecycle an administrator is given: create a login or link an
 * existing account, change the assigned roles, suspend, restore and revoke. Controls
 * are hidden when the caller lacks employee.manage_system_access, and when the account
 * is the caller's own, because the server refuses that outright.
 *
 * The role picker additionally needs rbac.view, since the role catalogue lives behind
 * that permission. Role names themselves come from the access payload, so the state is
 * always readable even without it.
 *
 * Passcode reset is offered here too, and is the ONLY way an employee who has forgotten
 * their password gets back in: `POST /auth/change-password`, which is what the mobile
 * app's "Нууц үг солих" calls, asks for the current password, and the product has no
 * self-service recovery by design. The control reuses the users screen's modal and its
 * `POST /users/:userId/reset-passcode`, so the rule that only a head_admin may reset
 * another administrator is applied by the same server code as before. It needs
 * `user.manage` rather than `employee.manage_system_access`, because that is the key
 * the endpoint actually asks for; a caller without it sees no button rather than a 403.
 */
export function EmployeeSystemAccessPanel({
  employeeId,
  access,
  onChanged,
}: {
  employeeId: string;
  access: EmployeeSystemAccessDto;
  onChanged: () => void;
}): ReactElement {
  const { can, user } = useAuth();
  const { notify } = useToast();

  const canManage = can(PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS) && !access.isSelf;
  const canPickRoles = can(PERMISSIONS.RBAC_VIEW);
  // The existing-account mode is only offered to a caller who can actually load the list.
  const canPickUsers = can(PERMISSIONS.USER_VIEW);
  // Resetting a passcode is a user-administration action reached from this screen, so it
  // answers to that module's key. It is withheld while the account is suspended: the
  // reset writes `must_change_password` unconditionally, which would lift the suspension
  // as a side effect of handing out a passcode. Restore first, then reset.
  const canResetPasscode =
    canManage &&
    can(PERMISSIONS.USER_MANAGE) &&
    access.hasAccount &&
    access.accountStatus !== 'suspended';

  const [createOpen, setCreateOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, setPending] = useState<LifecycleAction | null>(null);

  // The modal needs a real account to name. Every field is populated whenever
  // `hasAccount` is true, and the null guard keeps that a fact rather than an assumption.
  const resetTarget: PasscodeResetTarget | null =
    access.userId && access.fullName && access.email
      ? { id: access.userId, fullName: access.fullName, email: access.email }
      : null;

  async function runLifecycle(action: LifecycleAction, reason: string): Promise<void> {
    const payload = reason.trim() === '' ? {} : { reason: reason.trim() };
    try {
      if (action === 'suspend') await employeeService.suspendSystemAccess(employeeId, payload);
      if (action === 'restore') await employeeService.restoreSystemAccess(employeeId, payload);
      if (action === 'revoke') await employeeService.revokeSystemAccess(employeeId, payload);
      notify(LIFECYCLE_COPY[action].success, 'success');
      onChanged();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Үйлдэл гүйцэтгэж чадсангүй.', 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <Row label="Бүртгэл" value={access.hasAccount ? 'Холбогдсон' : 'Холбогдоогүй'} />
      <Row label="Нэвтрэх имэйл" value={access.email} />
      <Row
        label="Төлөв"
        value={access.accountStatus ? ACCOUNT_STATUS_LABELS[access.accountStatus] : null}
      />
      <Row label="Түвшин" value={access.role ? USER_ROLE_LABELS[access.role] : null} />
      <Row
        label="Олгосон эрх"
        value={access.roles.length > 0 ? access.roles.map((role) => role.name).join(', ') : null}
      />
      <Row label="Сүүлд нэвтэрсэн" value={access.lastLoginAt?.slice(0, 10)} />

      {access.isSelf && (
        <div className="mt-3">
          <Alert variant="info">Өөрийн эрхийг энэ дэлгэцээс өөрчлөх боломжгүй.</Alert>
        </div>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!access.hasAccount && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Нэвтрэх эрх үүсгэх
            </Button>
          )}

          {access.hasAccount && canPickRoles && (
            <Button size="sm" variant="secondary" onClick={() => setRolesOpen(true)}>
              Эрх өөрчлөх
            </Button>
          )}

          {canResetPasscode && resetTarget && (
            <Button size="sm" variant="secondary" onClick={() => setResetOpen(true)}>
              Нууц үг шинэчлэх
            </Button>
          )}

          {access.hasAccount && access.accountStatus !== 'suspended' && (
            <Button size="sm" variant="secondary" onClick={() => setPending('suspend')}>
              Түр хаах
            </Button>
          )}

          {access.hasAccount && access.accountStatus === 'suspended' && (
            <Button size="sm" variant="secondary" onClick={() => setPending('restore')}>
              Сэргээх
            </Button>
          )}

          {access.hasAccount && (
            <Button size="sm" variant="danger" onClick={() => setPending('revoke')}>
              Хүчингүй болгох
            </Button>
          )}
        </div>
      )}

      <CreateAccessDrawer
        employeeId={employeeId}
        open={createOpen}
        canPickRoles={canPickRoles}
        canPickUsers={canPickUsers}
        actorRole={user?.role ?? 'technician'}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          onChanged();
        }}
      />

      <ChangeRolesDrawer
        employeeId={employeeId}
        open={rolesOpen}
        current={access.roleIds}
        onClose={() => setRolesOpen(false)}
        onSaved={() => {
          setRolesOpen(false);
          onChanged();
        }}
      />

      {/* The modal renders nothing on a null target, so the open flag is the only gate. */}
      <ResetPasscodeModal
        target={resetOpen ? resetTarget : null}
        onClose={() => setResetOpen(false)}
        // The reset changes the account status to must_change_password, so the panel has
        // to re-read rather than keep showing "Идэвхтэй".
        onReset={onChanged}
      />

      {pending && (
        <ConfirmDialog
          open
          title={LIFECYCLE_COPY[pending].title}
          message={LIFECYCLE_COPY[pending].message}
          confirmLabel={LIFECYCLE_COPY[pending].confirmLabel}
          danger={LIFECYCLE_COPY[pending].danger}
          reasonLabel="Шалтгаан"
          onCancel={() => setPending(null)}
          onConfirm={(reason) => runLifecycle(pending, reason)}
        />
      )}
    </>
  );
}

function CreateAccessDrawer({
  employeeId,
  open,
  canPickRoles,
  canPickUsers,
  actorRole,
  onClose,
  onSaved,
}: {
  employeeId: string;
  open: boolean;
  canPickRoles: boolean;
  canPickUsers: boolean;
  actorRole: UserRole;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();

  const [mode, setMode] = useState<'CREATE_NEW' | 'LINK_EXISTING'>('CREATE_NEW');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('technician');
  const [userId, setUserId] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setMode('CREATE_NEW');
    setEmail('');
    setPassword('');
    setRole('technician');
    setUserId('');
    setSelectedRoles([]);
    setFormError(null);
    setFieldErrors({});
  }, [open]);

  useEffect(() => {
    if (!open || !canPickRoles) return;
    rbacService
      .roles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [open, canPickRoles]);

  useEffect(() => {
    if (!open || !canPickUsers) return;
    rbacService
      .users({ limit: 100 })
      .then((page) => setUsers(page.items))
      .catch(() => setUsers([]));
  }, [open, canPickUsers]);

  const toggleRole = useCallback((roleId: string): void => {
    setSelectedRoles((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  }, []);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const payload =
      mode === 'CREATE_NEW'
        ? {
            mode,
            email: email.trim(),
            password,
            role,
            ...(selectedRoles.length > 0 ? { roleIds: selectedRoles } : {}),
          }
        : {
            mode,
            userId,
            ...(selectedRoles.length > 0 ? { roleIds: selectedRoles } : {}),
          };

    const parsed = linkSystemAccessSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      await employeeService.manageSystemAccess(employeeId, parsed.data);
      notify('Системийн эрх үүслээ.', 'success');
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

  // A plain admin may not mint an account at or above their own tier; the same rule is
  // re-checked on the server.
  const assignableRoles = USER_ROLES.filter((entry) => canManageRole(actorRole, entry));

  return (
    <Drawer
      open={open}
      title="Нэвтрэх эрх үүсгэх"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Болих
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        <Alert variant="info">
          Түр нууц үгийг ажилтанд өөрт нь дамжуулна. Эхний удаа нэвтрэхдээ заавал солино.
        </Alert>

        {canPickUsers && (
          <Field label="Хэлбэр">
            <SelectInput
              value={mode}
              onChange={(value) => setMode(value as 'CREATE_NEW' | 'LINK_EXISTING')}
              options={[
                { value: 'CREATE_NEW', label: 'Шинэ бүртгэл үүсгэх' },
                { value: 'LINK_EXISTING', label: 'Одоо байгаа хэрэглэгч холбох' },
              ]}
              disabled={submitting}
            />
          </Field>
        )}

        {mode === 'CREATE_NEW' ? (
          <div className="grid grid-cols-1 gap-3">
            <Field label="Нэвтрэх имэйл" required error={fieldErrors.email}>
              <TextInput type="email" value={email} onChange={setEmail} disabled={submitting} />
            </Field>
            <Field
              label="Түр нууц үг"
              required
              error={fieldErrors.password}
              hint="Дор хаяж 10 тэмдэгт"
            >
              <TextInput
                type="password"
                value={password}
                onChange={setPassword}
                disabled={submitting}
              />
            </Field>
            <Field label="Түвшин" required error={fieldErrors.role}>
              <SelectInput
                value={role}
                onChange={(value) => setRole(value as UserRole)}
                options={assignableRoles.map((entry) => ({
                  value: entry,
                  label: USER_ROLE_LABELS[entry],
                }))}
                disabled={submitting}
              />
            </Field>
          </div>
        ) : (
          <Field label="Хэрэглэгч" required error={fieldErrors.userId}>
            <SelectInput
              value={userId}
              onChange={setUserId}
              placeholder="Сонгоно уу"
              options={users.map((entry) => ({
                value: entry.id,
                label: `${entry.fullName} (${entry.email})`,
              }))}
              disabled={submitting}
            />
          </Field>
        )}

        {canPickRoles && (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Олгох эрх</p>
            <RoleChecklist
              roles={roles}
              selected={selectedRoles}
              onToggle={toggleRole}
              disabled={submitting}
            />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function ChangeRolesDrawer({
  employeeId,
  open,
  current,
  onClose,
  onSaved,
}: {
  employeeId: string;
  open: boolean;
  current: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();

  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected([...current]);
    setReason('');
    setFormError(null);
    rbacService
      .roles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [open, current]);

  const toggle = useCallback((roleId: string): void => {
    setSelected((entries) =>
      entries.includes(roleId) ? entries.filter((id) => id !== roleId) : [...entries, roleId],
    );
  }, []);

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setFormError(null);
    try {
      await employeeService.updateSystemAccessRoles(employeeId, {
        roleIds: selected,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      notify('Хэрэглэгчийн эрх шинэчлэгдлээ.', 'success');
      onSaved();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Эрх шинэчилж чадсангүй.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Эрх өөрчлөх"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Болих
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        <RoleChecklist roles={roles} selected={selected} onToggle={toggle} disabled={submitting} />
        <Field label="Шалтгаан" hint="Аудит бүртгэлд хадгалагдана">
          <TextInput value={reason} onChange={setReason} disabled={submitting} />
        </Field>
      </div>
    </Drawer>
  );
}
