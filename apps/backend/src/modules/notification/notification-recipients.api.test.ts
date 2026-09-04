import { PERMISSIONS } from '@monhorus/shared';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { Notification } from './notification.model';
import { notify } from './notification.service';

/**
 * Who a notification actually reaches, after the permission keys became constants.
 *
 * The fifteen `notify({ permission: '<key>' })` call sites now pass `PERMISSIONS.X`. The
 * swap is only safe if the constant carries the identical string, because that string is
 * matched against `Role.permissions` to select recipients — a key that resolves to nothing
 * addresses NOBODY, and `notify` swallows that silently.
 *
 * On the audit's claim that a typo was previously undetectable: it was not. `NotifyInput`
 * types `permission` as `PermissionKey`, a literal union built from `PERMISSIONS` with
 * `as const`, so a misspelt literal has always been a compile error (TS2820, with a "did
 * you mean"). That is asserted at the type level below, since a test cannot catch what the
 * compiler rejects before the test runs.
 */
describe('notification recipients by permission', () => {
  beforeAll(async () => {
    await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
  });

  /*
   * The values the swap depended on. Every literal that was replaced is listed here against
   * its constant: if a constant is ever repointed, the call sites change audience silently
   * and this is what says so.
   */
  it('keeps the exact strings the replaced literals carried', () => {
    expect(PERMISSIONS.DISPATCH_VIEW).toBe('dispatch.view');
    expect(PERMISSIONS.DISPATCH_ASSIGN).toBe('dispatch.assign');
    expect(PERMISSIONS.INVOICE_VIEW).toBe('invoice.view');
    expect(PERMISSIONS.SERVICE_REQUEST_CLAIM).toBe('service_request.claim');
    expect(PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS).toBe('service_request.change_status');
  });

  it('reaches the holders of the addressed key and nobody else', async () => {
    const dispatcher = await createUserWithPermissions('dispatcher@test.mn', [
      PERMISSIONS.DISPATCH_VIEW,
    ]);
    const alsoDispatch = await createUserWithPermissions('dispatch2@test.mn', [
      PERMISSIONS.DISPATCH_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);
    // Holds a different key entirely: the broadcast this whole area was written to end.
    const technician = await createUserWithPermissions('tech@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);

    await notify({
      event: 'SERVICE_REQUEST_STATUS_CHANGED',
      title: 'SR-202608-0001 төлөв өөрчлөгдлөө',
      body: null,
      entityType: 'Work',
      entityId: new Types.ObjectId(),
      linkPath: null,
      permission: PERMISSIONS.DISPATCH_VIEW,
    });

    const rows = await Notification.find().lean();
    const recipients = rows.map((row) => String(row.recipient));

    expect(recipients).toContain(dispatcher.userId);
    expect(recipients).toContain(alsoDispatch.userId);
    expect(recipients).not.toContain(technician.userId);
  });

  it('addresses a different audience for a different key', async () => {
    const dispatcher = await createUserWithPermissions('d@test.mn', [PERMISSIONS.DISPATCH_VIEW]);
    const finance = await createUserWithPermissions('f@test.mn', [PERMISSIONS.INVOICE_VIEW]);

    await notify({
      event: 'INVOICE_DUE_SOON',
      title: 'INV-202608-0001 хугацаа дөхлөө',
      body: null,
      entityType: 'Invoice',
      entityId: new Types.ObjectId(),
      linkPath: null,
      permission: PERMISSIONS.INVOICE_VIEW,
    });

    const recipients = (await Notification.find().lean()).map((row) => String(row.recipient));

    expect(recipients).toContain(finance.userId);
    expect(recipients).not.toContain(dispatcher.userId);
  });

  /*
   * The compile-time half, recorded as an assertion the type checker enforces. Uncommenting
   * a misspelt key here fails `tsc`, which is the guarantee the audit asked for and which
   * `permission?: PermissionKey` already provided.
   */
  it('rejects a key that is not in the catalogue, at compile time', () => {
    const good: Parameters<typeof notify>[0]['permission'] = PERMISSIONS.DISPATCH_VIEW;
    expect(good).toBe('dispatch.view');

    // @ts-expect-error 'dispatach.view' is not a PermissionKey — this is the typo guard.
    const bad: Parameters<typeof notify>[0]['permission'] = 'dispatach.view';
    expect(bad).toBe('dispatach.view');
  });
});
