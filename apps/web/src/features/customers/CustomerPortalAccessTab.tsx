import {
  ACCOUNT_STATUS_LABELS,
  PERMISSIONS,
  canManageRole,
  type AccountStatus,
  type CreateUserResponse,
  type UserDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { generatePasscode } from '../../lib/passcode';
import { userService } from '../../services/user.service';

/** The server refuses a caller acting on their own account, so the item is dead here too. */
const SELF_TARGET_REASON = 'Өөрийн бүртгэл дээр энэ үйлдлийг хийх боломжгүй.';

type LifecycleAction = 'suspend' | 'restore' | 'reset';

const LIFECYCLE_COPY: Record<
  LifecycleAction,
  { title: string; message: string; confirmLabel: string; danger: boolean; success: string }
> = {
  suspend: {
    title: 'Нэвтрэх эрх түр хаах',
    message:
      'Энэ бүртгэлийн нэвтрэх эрхийг түр хаах уу? Нээлттэй сесс тэр даруй тасарна. Бүртгэл болон түүх хэвээр үлдэнэ.',
    confirmLabel: 'Тийм, түр хаах',
    danger: true,
    success: 'Нэвтрэх эрх түр хаагдлаа.',
  },
  restore: {
    title: 'Нэвтрэх эрх идэвхжүүлэх',
    message:
      'Түр хаагдсан нэвтрэх эрхийг идэвхжүүлэх үү? Харилцагч порталд дахин нэвтрэх боломжтой болно.',
    confirmLabel: 'Тийм, идэвхжүүлэх',
    danger: false,
    success: 'Нэвтрэх эрх идэвхжлээ.',
  },
  reset: {
    title: 'Нууц үг сэргээх',
    message:
      'Шинэ түр нууц үг үүсгэх үү? Одоогийн нууц үг хүчингүй болж, нээлттэй сесс тасарна. Харилцагч дараагийн удаа нэвтрэхдээ түр нууц үгээ солино.',
    confirmLabel: 'Тийм, сэргээх',
    danger: true,
    success: 'Түр нууц үг үүслээ.',
  },
};

const STATUS_TONE: Record<AccountStatus, string> = {
  active: 'bg-green-50 text-green-700 ring-green-200',
  suspended: 'bg-slate-100 text-slate-600 ring-slate-200',
  must_change_password: 'bg-amber-50 text-amber-700 ring-amber-200',
};

interface OneTimeSecret {
  mode: 'create' | 'reset';
  fullName: string;
  email: string;
  temporaryPassword: string;
}

function StatusBadge({ status }: { status: AccountStatus }): ReactElement {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[status]}`}
    >
      {ACCOUNT_STATUS_LABELS[status]}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * The portal logins of one customer organisation.
 *
 * A customer signs in through the same endpoint as staff; what makes the account a tenant
 * reader is its link to this organisation, which the server resolves from the account and
 * never accepts from a request. So the organisation here comes from the route and the role
 * is fixed to `customer` — neither is offered as a choice, because any other combination is
 * refused server-side anyway.
 *
 * Every write is gated on user.manage, matching the key the /users routes require.
 */
export function CustomerPortalAccessTab({ customerId }: { customerId: string }): ReactElement {
  const { can, user: actor } = useAuth();
  const { notify } = useToast();

  const [rows, setRows] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<{ action: LifecycleAction; account: UserDto } | null>(
    null,
  );
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);

  // `canManageRole` is the predicate the server applies to the target role. A plain admin
  // passes it for `customer`, so this only withholds the controls from a lower tier.
  const canManage =
    can(PERMISSIONS.USER_MANAGE) && (actor ? canManageRole(actor.role, 'customer') : false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await userService.list({ customerId, limit: 100 });
      setRows(page.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Нэвтрэх эрх ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runLifecycle(
    action: LifecycleAction,
    account: UserDto,
    reason: string,
  ): Promise<void> {
    const withReason = reason.trim() === '' ? {} : { reason: reason.trim() };
    try {
      if (action === 'reset') {
        const result = await userService.resetPasscode(account.id, {
          newPassword: generatePasscode(),
          ...withReason,
        });
        setSecret({
          mode: 'reset',
          fullName: result.user.fullName,
          email: result.user.email,
          temporaryPassword: result.temporaryPassword,
        });
      } else {
        await userService.updateStatus(account.id, {
          status: action === 'suspend' ? 'suspended' : 'active',
          ...withReason,
        });
      }
      notify(LIFECYCLE_COPY[action].success, 'success');
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Үйлдэл гүйцэтгэж чадсангүй.', 'error');
    } finally {
      setPending(null);
    }
  }

  const columns: ReadonlyArray<Column<UserDto>> = [
    {
      key: 'fullName',
      header: 'Нэр',
      render: (row) => <span className="font-medium text-slate-900">{row.fullName}</span>,
    },
    {
      key: 'email',
      header: 'Нэвтрэх имэйл',
      render: (row) => <span className="break-all text-slate-700">{row.email}</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'lastLoginAt',
      header: 'Сүүлд нэвтэрсэн',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.lastLoginAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        if (!canManage) return null;

        const isSelf = actor?.id === row.id;
        const items: RowActionItem[] = [
          row.status === 'suspended'
            ? {
                label: 'Идэвхжүүлэх',
                onSelect: () => setPending({ action: 'restore', account: row }),
                disabled: isSelf,
                disabledReason: SELF_TARGET_REASON,
              }
            : {
                label: 'Түр хаах',
                tone: 'danger',
                onSelect: () => setPending({ action: 'suspend', account: row }),
                disabled: isSelf,
                disabledReason: SELF_TARGET_REASON,
              },
          {
            label: 'Нууц үг сэргээх',
            onSelect: () => setPending({ action: 'reset', account: row }),
            disabled: isSelf,
            disabledReason: SELF_TARGET_REASON,
          },
        ];

        return <RowActions items={items} />;
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-600">
          Харилцагчийн порталд нэвтрэх бүртгэл. Эдгээр хэрэглэгч зөвхөн энэ байгууллагын
          мэдээллийг харна.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Нэвтрэх эрх үүсгэх
          </Button>
        )}
      </div>

      {/* Already inside CustomerDetailPage's white card, so this takes the ring-only
          treatment the sibling tabs use rather than nesting a second white card. */}
      <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          ariaLabel="Нэвтрэх эрх"
          emptyTitle="Нэвтрэх эрх байхгүй"
          emptyDescription="Энэ харилцагчид порталд нэвтрэх бүртгэл үүсгээгүй байна."
        />
      </div>

      <CreatePortalAccountModal
        customerId={customerId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          setSecret({
            mode: 'create',
            fullName: created.user.fullName,
            email: created.user.email,
            temporaryPassword: created.temporaryPassword,
          });
          void load();
        }}
      />

      {pending && (
        <ConfirmDialog
          open
          title={LIFECYCLE_COPY[pending.action].title}
          message={LIFECYCLE_COPY[pending.action].message}
          confirmLabel={LIFECYCLE_COPY[pending.action].confirmLabel}
          danger={LIFECYCLE_COPY[pending.action].danger}
          reasonLabel="Шалтгаан"
          onCancel={() => setPending(null)}
          onConfirm={(reason) => runLifecycle(pending.action, pending.account, reason)}
        />
      )}

      {secret && <OneTimePasscodeModal secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

/**
 * The only place a temporary passcode is ever displayed.
 *
 * The server stores it as a hash and echoes the plaintext exactly once in the response that
 * created it, so there is no second chance to read it and nothing here writes it anywhere
 * else — no toast, no console, no state that outlives this dialog.
 */
function OneTimePasscodeModal({
  secret,
  onClose,
}: {
  secret: OneTimeSecret;
  onClose: () => void;
}): ReactElement {
  return (
    <Modal
      open
      title={secret.mode === 'create' ? 'Нэвтрэх эрх үүслээ' : 'Нууц үг сэргээгдлээ'}
      onClose={onClose}
      footer={<Button onClick={onClose}>Хаах</Button>}
    >
      <div className="space-y-4">
        <Alert variant="success" title="Амжилттай">
          <strong>{secret.fullName}</strong> ({secret.email}){' '}
          {secret.mode === 'create'
            ? 'нэвтрэх эрхтэй боллоо.'
            : 'бүртгэлийн нууц үг шинэчлэгдлээ.'}
        </Alert>

        <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Түр нууц үг</p>
          <p className="mt-1 select-all break-all font-mono text-base font-semibold text-slate-900">
            {secret.temporaryPassword}
          </p>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(secret.temporaryPassword)}
            className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Хуулах
          </button>
        </div>

        <Alert variant="warning" title="Анхаар">
          Энэ нууц үг дахин харагдахгүй. Харилцагчид аюулгүй сувгаар дамжуулна уу. Тэрээр анх
          нэвтрэхдээ заавал нууц үгээ солино.
        </Alert>
      </div>
    </Modal>
  );
}

function CreatePortalAccountModal({
  customerId,
  open,
  onClose,
  onCreated,
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreateUserResponse) => void;
}): ReactElement {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // Shown and editable rather than minted silently at submit: the administrator has to
  // read this value out to the customer, so they need it in front of them before they
  // commit, and a regenerate link is cheaper than closing and reopening the form.
  const [password, setPassword] = useState(generatePasscode);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setEmail('');
    setPhone('');
    setPassword(generatePasscode());
    setFormError(null);
    setFieldErrors({});
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Client-side mirror of the server schema, so the obvious mistakes never cost a request.
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    const errors: Record<string, string> = {};
    if (trimmedName.length < 2) errors.fullName = 'Нэр дор хаяж 2 тэмдэгттэй байна.';
    if (trimmedEmail === '') errors.email = 'Имэйл заавал.';
    // The server enforces the same floor; stating it here keeps a hand-edited passcode
    // from costing a round trip.
    if (password.trim().length < 10) errors.password = 'Нууц үг дор хаяж 10 тэмдэгт.';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const created = await userService.create({
        fullName: trimmedName,
        email: trimmedEmail,
        password: password.trim(),
        phone: phone.trim() || null,
        // Both fixed by the screen: this tab exists to give THIS organisation a portal
        // login, and the server refuses a customer account that is not linked to one.
        role: 'customer',
        customerId,
        requirePasswordChange: true,
      });
      onCreated(created);
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

  return (
    <Modal
      open={open}
      title="Нэвтрэх эрх үүсгэх"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button type="submit" form="create-portal-account-form" loading={submitting}>
            Үүсгэх
          </Button>
        </>
      }
    >
      <form
        id="create-portal-account-form"
        onSubmit={handleSubmit}
        className="space-y-4"
        noValidate
      >
        {formError && <Alert variant="error">{formError}</Alert>}

        <Alert variant="info">
          Бүртгэл энэ харилцагч дээр үүснэ. Хэрэглэгч зөвхөн энэ байгууллагын хүсэлт, объект,
          нэхэмжлэлийг харна.
        </Alert>

        <Input
          label="Бүтэн нэр"
          required
          autoFocus
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          error={fieldErrors.fullName}
          disabled={submitting}
        />
        <Input
          label="Нэвтрэх имэйл"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          placeholder="name@company.mn"
          disabled={submitting}
        />
        <Input
          label="Утас"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={fieldErrors.phone}
          hint="Сонголттой. Жишээ: 9911-2233"
          disabled={submitting}
        />

        <div className="space-y-1.5">
          <Input
            label="Түр нууц үг"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            className="font-mono"
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setPassword(generatePasscode())}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
            disabled={submitting}
          >
            Шинээр үүсгэх
          </button>
        </div>
      </form>
    </Modal>
  );
}
