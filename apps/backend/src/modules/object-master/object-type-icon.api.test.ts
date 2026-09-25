import fs from 'node:fs';

import { MAX_OBJECT_TYPE_ICON_BYTES, PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { hashPassword } from '../../utils/password.util';
import { Customer } from '../objects/object.models';
import { Role } from '../rbac/role.model';
import { resolveStoredFilePath } from '../storage/storage.service';
import { StoredFile } from '../storage/stored-file.model';
import { sanitiseSvgIcon } from '../storage/svg-sanitiser';
import { User } from '../user/user.model';
import { ObjectRecord, ObjectType } from './object-master.models';

/**
 * Custom uploaded SVG icons on an equipment type.
 *
 * Two things are being defended here and they are not the same thing.
 *
 * The first is that an SVG is executable content: it is the one image format that is also a
 * document, and accepting one from a user is accepting markup. The answer is to sanitise
 * ONCE, BEFORE STORING — so the suite asserts the BYTES ON DISK, never merely a 200. A
 * route that stored a hostile file and cleaned it on the way out would pass a status-code
 * test and still have a live payload sitting in the upload directory.
 *
 * The second is that the protection must not be able to erode silently. Today an inline
 * script in a served SVG happens to be blocked by `helmet()`'s default `script-src 'self'`
 * — a default nobody chose for this and no test pinned. The header assertions below exist
 * so that stops being true: relaxing the policy on this response now fails a test.
 */

const API = '/api/v1';

const MANAGE = [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE] as const;

/** Exactly what the CUSTOMER system role holds for this module. No staff key appears. */
const PORTAL = [
  PERMISSIONS.PORTAL_PROJECT_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
] as const;

let app: Express;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

let portalRoleSequence = 0;

async function loginAsCustomer(
  email: string,
  linkedCustomerId: string | null,
  permissions: readonly PermissionKey[] = PORTAL,
): Promise<string> {
  portalRoleSequence += 1;

  const role = await Role.create({
    key: `TEST_ICON_PORTAL_ROLE_${portalRoleSequence}`,
    name: `Portal role ${email}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });

  const password = 'PortalPassword2026x';
  await User.create({
    fullName: `Portal ${email}`,
    email,
    password: await hashPassword(password),
    role: 'customer',
    roles: [role._id],
    status: 'active',
    customer: linkedCustomerId ? new Types.ObjectId(linkedCustomerId) : null,
    passwordChangedAt: new Date(),
  });

  return login(email, password);
}

/** A perfectly ordinary two-path icon, of the sort a designer would actually hand over. */
const CLEAN_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <title>Самбар</title>
  <style>.body { fill: #1d4ed8; }</style>
  <rect class="body" x="3" y="2" width="18" height="20" rx="2"/>
  <path d="M7 7h10M7 12h10" stroke="#fff" stroke-width="1.5" fill="none"/>
</svg>`;

/**
 * One document carrying every attack the brief names, so a single upload proves all four
 * are removed rather than four uploads each proving one.
 */
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)">
  <script type="text/javascript">alert(document.cookie)</script>
  <a href="javascript:alert(2)"><rect x="0" y="0" width="24" height="24"/></a>
  <foreignObject width="24" height="24"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(3)"/></body></foreignObject>
  <image href="https://evil.example/pixel.png" width="24" height="24"/>
  <use xlink:href="https://evil.example/remote.svg#icon"/>
  <style>@import url("https://evil.example/x.css"); .a { fill: red; }</style>
  <path d="M4 4h16v16H4z" fill="#000" onmouseover="alert(4)"/>
</svg>`;

/** Not an SVG at all: a real PNG header, so nothing about the bytes is SVG-shaped. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

let customerId: string;

beforeEach(async () => {
  await resetDomainCollections();
  const staff = await createUserWithPermissions('icon-staff@test.mn', MANAGE);
  token = await login(staff.email, staff.password);
  const customer = await Customer.create({ code: 'ICO', name: 'Айкон ХХК' });
  customerId = String(customer._id);
});

/** Uploads an icon and returns the raw response, so a test can assert a refusal too. */
function uploadIcon(
  body: Buffer | string,
  filename = 'icon.svg',
  contentType = 'image/svg+xml',
  bearer = (): string => token,
): request.Test {
  return request(app)
    .post(`${API}/files/object-type-icons`)
    .set('Authorization', `Bearer ${bearer()}`)
    .attach('file', Buffer.isBuffer(body) ? body : Buffer.from(body), { filename, contentType });
}

/**
 * Downloads a file as raw bytes.
 *
 * Superagent hands back an empty `text` for anything it does not consider textual, and
 * `image/svg+xml` is one of those, so the response has to be buffered by hand. Worth the
 * few lines: asserting the SERVED bytes is the only way to show that nothing is cleaned at
 * read time and that what the browser gets is what was stored.
 */
function downloadRaw(fileId: string, bearer: string): request.Test {
  return request(app)
    .get(`${API}/files/${fileId}`)
    .set('Authorization', `Bearer ${bearer}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

/** What is actually on the disk behind a StoredFile id. The only claim that matters. */
async function storedBytes(fileId: string): Promise<string> {
  const file = await StoredFile.findById(fileId);
  expect(file).not.toBeNull();
  return fs.readFileSync(resolveStoredFilePath(file?.storageKey as string), 'utf8');
}

async function createType(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request(app)
    .post(`${API}/object-types`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      code: `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Хуваарилах самбар',
      category: 'PANEL',
      icon: 'PANEL',
      showOnPlan: true,
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.data as Record<string, unknown>;
}

// -- Upload and sanitising ---------------------------------------------------

describe('POST /files/object-type-icons', () => {
  it('accepts a real SVG and stores the sanitised bytes', async () => {
    const response = await uploadIcon(CLEAN_SVG);

    expect(response.status).toBe(201);
    expect(response.body.data.mimeType).toBe('image/svg+xml');

    const stored = await storedBytes(response.body.data.id as string);
    // The drawing survived intact — sanitising is not the same as gutting.
    expect(stored).toContain('<rect');
    expect(stored).toContain('d="M7 7h10M7 12h10"');
    expect(stored).toContain('viewBox="0 0 24 24"');
    expect(stored).toContain('xmlns="http://www.w3.org/2000/svg"');
    // The XML declaration is a parser artefact, not content, and is not re-emitted.
    expect(stored.startsWith('<svg')).toBe(true);

    // `sizeBytes` describes what was STORED, not what arrived, so a download that trusts it
    // for Content-Length cannot truncate or over-read the file.
    const file = await StoredFile.findById(response.body.data.id as string);
    expect(file?.sizeBytes).toBe(Buffer.byteLength(stored, 'utf8'));
  });

  it('strips script, event handlers, javascript: urls and foreignObject from the stored file', async () => {
    const response = await uploadIcon(HOSTILE_SVG);
    expect(response.status).toBe(201);

    const stored = await storedBytes(response.body.data.id as string);

    // Asserted against the bytes on disk. A 200 proves nothing about what was written.
    expect(stored).not.toContain('script');
    expect(stored).not.toContain('alert');
    expect(stored).not.toContain('onload');
    expect(stored).not.toContain('onmouseover');
    expect(stored).not.toContain('onerror');
    expect(stored).not.toContain('javascript:');
    expect(stored).not.toContain('foreignObject');
    expect(stored).not.toContain('evil.example');
    expect(stored).not.toContain('@import');
    expect(stored).not.toContain('<image');
    expect(stored).not.toContain('<a ');
    expect(stored).not.toContain('xlink:href');

    // And the harmless drawing inside it is still there, so the sanitiser is doing surgery
    // rather than deleting anything it does not like the look of.
    expect(stored).toContain('d="M4 4h16v16H4z"');
  });

  it('refuses a PNG renamed .svg, whether or not the content type is forged', async () => {
    const honest = await uploadIcon(PNG_BYTES, 'icon.svg', 'image/png');
    expect(honest.status).toBe(400);

    // The interesting one: the declared type says SVG and the bytes do not. The content
    // type is a claim; the parser is the evidence.
    const forged = await uploadIcon(PNG_BYTES, 'icon.svg', 'image/svg+xml');
    expect(forged.status).toBe(400);

    expect(await StoredFile.countDocuments({ ownerType: 'OBJECT_TYPE' })).toBe(0);
  });

  it('refuses an oversized SVG', async () => {
    // Valid markup, just far too much of it: the limit is about size, not about content.
    const filler = '<rect x="0" y="0" width="1" height="1"/>'.repeat(2000);
    const oversized = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${filler}</svg>`;
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(MAX_OBJECT_TYPE_ICON_BYTES);

    const response = await uploadIcon(oversized);
    expect(response.status).toBe(400);
    expect(await StoredFile.countDocuments({ ownerType: 'OBJECT_TYPE' })).toBe(0);
  });

  it('refuses a caller who may view the registry but not manage it', async () => {
    const viewer = await createUserWithPermissions('icon-viewer@test.mn', [
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    const viewerToken = await login(viewer.email, viewer.password);

    const response = await uploadIcon(CLEAN_SVG, 'icon.svg', 'image/svg+xml', () => viewerToken);
    expect(response.status).toBe(403);
  });
});

// -- Serving -----------------------------------------------------------------

describe('GET /files/:fileId for an SVG icon', () => {
  it('serves it renderable and locked down, with the headers asserted', async () => {
    const upload = await uploadIcon(CLEAN_SVG);
    expect(upload.status).toBe(201);

    const response = await downloadRaw(upload.body.data.id as string, token);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    // Renderable: an attachment disposition would download the icon instead of drawing it.
    expect(response.headers['content-disposition']).toContain('inline');

    /**
     * THE PIN. These two headers are the second layer of defence, and until now the only
     * thing resembling them was an unchosen helmet default with no test behind it. If a
     * future change relaxes or drops either, this fails.
     */
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');

    // Served bytes and stored bytes are the same thing: nothing is cleaned at read time,
    // because nothing dirty ever reached storage.
    expect((response.body as Buffer).toString('utf8')).toBe(
      await storedBytes(upload.body.data.id as string),
    );
  });

  it('serves the sanitised hostile icon with no payload left in the response', async () => {
    const upload = await uploadIcon(HOSTILE_SVG);
    expect(upload.status).toBe(201);

    const response = await downloadRaw(upload.body.data.id as string, token);
    const served = (response.body as Buffer).toString('utf8');

    expect(response.status).toBe(200);
    expect(served).not.toContain('script');
    expect(served).not.toContain('onload');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });
});

// -- Access control ----------------------------------------------------------

describe('object type icon access control', () => {
  /**
   * The icon is GLOBAL, and this proves the guard was exercised rather than skipped.
   *
   * `assertFileInCustomerScope` runs for every customer caller and reaches an explicit
   * `OBJECT_TYPE` case that says there is no tenant to check. The two customers below are
   * linked to different organisations and neither owns the registry, because nobody does —
   * so both must be served, and a 404 for either would mean the file fell through to the
   * refusal at the bottom of that switch.
   */
  it('serves the icon to a customer of any organisation, because it belongs to none', async () => {
    const upload = await uploadIcon(CLEAN_SVG);
    const fileId = upload.body.data.id as string;

    const other = await Customer.create({ code: 'OTH', name: 'Өөр ХХК' });

    for (const [email, linked] of [
      ['icon-portal-a@test.mn', customerId],
      ['icon-portal-b@test.mn', String(other._id)],
    ] as const) {
      const portalToken = await loginAsCustomer(email, linked);
      const response = await request(app)
        .get(`${API}/files/${fileId}`)
        .set('Authorization', `Bearer ${portalToken}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
  });

  it('still refuses a caller holding no permission that admits an object type', async () => {
    const upload = await uploadIcon(CLEAN_SVG);

    // A real customer account, linked to a real organisation, holding portal keys for
    // everything EXCEPT objects. Global does not mean unguarded.
    const strangerToken = await loginAsCustomer('icon-portal-c@test.mn', customerId, [
      PERMISSIONS.PORTAL_PROJECT_VIEW,
      PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
    ]);

    const response = await request(app)
      .get(`${API}/files/${upload.body.data.id as string}`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(response.status).toBe(403);
  });
});

// -- Attaching, replacing, clearing ------------------------------------------

describe('object type icon lifecycle', () => {
  it('sets an icon at creation and surfaces it on the DTO', async () => {
    const upload = await uploadIcon(CLEAN_SVG);
    const fileId = upload.body.data.id as string;

    const type = await createType({ iconFileId: fileId });

    expect(type.iconFileId).toBe(fileId);
    expect(type.iconUrl).toBe(`/api/v1/files/${fileId}`);
    // The enum is untouched and still present: it is the fallback, not a replaced field.
    expect(type.icon).toBe('PANEL');

    // The file was re-owned onto the type rather than left parked on the uploader.
    const file = await StoredFile.findById(fileId);
    expect(String(file?.ownerId)).toBe(type.id);
  });

  it('replaces an icon and deletes the file it replaced', async () => {
    const first = await uploadIcon(CLEAN_SVG);
    const type = await createType({ iconFileId: first.body.data.id as string });

    const second = await uploadIcon(CLEAN_SVG.replace('#1d4ed8', '#dc2626'));
    const response = await request(app)
      .patch(`${API}/object-types/${type.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ iconFileId: second.body.data.id as string });

    expect(response.status).toBe(200);
    expect(response.body.data.iconFileId).toBe(second.body.data.id);

    // The replaced file is gone from the database and from the disk, not orphaned.
    expect(await StoredFile.findById(first.body.data.id as string)).toBeNull();
  });

  it('clears an icon and falls back to the enum', async () => {
    const upload = await uploadIcon(CLEAN_SVG);
    const type = await createType({ iconFileId: upload.body.data.id as string, icon: 'BREAKER' });

    const response = await request(app)
      .patch(`${API}/object-types/${type.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ iconFileId: null });

    expect(response.status).toBe(200);
    expect(response.body.data.iconFileId).toBeNull();
    expect(response.body.data.iconUrl).toBeNull();
    // Falling back means the enum is what the client now draws.
    expect(response.body.data.icon).toBe('BREAKER');

    expect(await StoredFile.findById(upload.body.data.id as string)).toBeNull();
  });

  it('leaves a type with no custom icon exactly as it was — no migration', async () => {
    // Written straight to the collection with no `iconFile` path at all, which is precisely
    // the shape of every row that existed before this feature.
    const legacy = await ObjectType.collection.insertOne({
      code: 'LEGACY-1',
      name: 'Хуучин төрөл',
      description: null,
      category: 'PANEL',
      showOnPlan: true,
      insidePanel: false,
      generatesConclusion: true,
      icon: 'PANEL',
      isActive: true,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .get(`${API}/object-types/${String(legacy.insertedId)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.icon).toBe('PANEL');
    expect(response.body.data.iconFileId).toBeNull();
    expect(response.body.data.iconUrl).toBeNull();
  });

  it('refuses an iconFileId that is not an object-type icon', async () => {
    // A file that exists but belongs to another owner kind. Accepting it would make the
    // icon's broader permissions a way to read a narrower kind of file.
    const foreign = await StoredFile.create({
      storageKey: 'not-an-icon.bin',
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      ownerType: 'EMPLOYEE',
      ownerId: new Types.ObjectId(),
      uploadedBy: null,
      uploadedByName: null,
    });

    const response = await request(app)
      .post(`${API}/object-types`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'BAD-ICON',
        name: 'Буруу айкон',
        category: 'PANEL',
        icon: 'PANEL',
        iconFileId: String(foreign._id),
      });

    expect(response.status).toBe(400);
    // And no type was registered on the way to the refusal.
    expect(await ObjectType.countDocuments({ code: 'BAD-ICON' })).toBe(0);
  });
});

// -- What the floor plan reads -----------------------------------------------

describe('GET /objects inlines the icon per row', () => {
  it('carries iconUrl on the object list item, so the plan needs no second call', async () => {
    const upload = await uploadIcon(CLEAN_SVG);
    const withIcon = await createType({ iconFileId: upload.body.data.id as string });
    const withoutIcon = await createType({ icon: 'SOCKET' });

    for (const [index, type] of [withIcon, withoutIcon].entries()) {
      await ObjectRecord.create({
        code: `OBJ-${index}`,
        name: `Объект ${index}`,
        category: 'PANEL',
        objectType: new Types.ObjectId(type.id as string),
        customer: new Types.ObjectId(customerId),
        status: 'ACTIVE',
      });
    }

    const response = await request(app)
      .get(`${API}/objects-master?customerId=${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const rows = response.body.data.items as { objectType: Record<string, unknown> }[];
    expect(rows).toHaveLength(2);

    const custom = rows.find((row) => row.objectType.id === withIcon.id);
    const builtIn = rows.find((row) => row.objectType.id === withoutIcon.id);

    expect(custom?.objectType.iconUrl).toBe(`/api/v1/files/${upload.body.data.id as string}`);
    expect(custom?.objectType.icon).toBe('PANEL');
    // No custom icon: null, and the client falls back to the enum it already understood.
    expect(builtIn?.objectType.iconUrl).toBeNull();
    expect(builtIn?.objectType.icon).toBe('SOCKET');
  });
});

// -- The sanitiser itself ----------------------------------------------------

/**
 * Direct unit coverage for the cases that are awkward to express as an upload, and for the
 * shape of the refusal. These run in microseconds and pin the parser's contract.
 */
describe('sanitiseSvgIcon', () => {
  const sanitise = (svg: string): string => sanitiseSvgIcon(Buffer.from(svg));

  it('refuses a DOCTYPE, which is how entity expansion arrives', () => {
    expect(() =>
      sanitise(
        `<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>
         <svg xmlns="http://www.w3.org/2000/svg"><title>&lol2;</title></svg>`,
      ),
    ).toThrow();
  });

  it('refuses an unknown entity reference rather than passing it through', () => {
    expect(() => sanitise('<svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title></svg>'))
      .toThrow();
  });

  it('sees through a numeric character reference hiding a javascript: url', () => {
    // `&#106;` is `j`. A checker reading the raw text would not find `javascript:` here.
    const out = sanitise(
      `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" fill="&#106;avascript:alert(1)"/></svg>`,
    );
    expect(out).not.toContain('avascript');
    expect(out).not.toContain('fill=');
  });

  it('keeps a local url() reference and drops a remote one', () => {
    const out = sanitise(
      `<svg xmlns="http://www.w3.org/2000/svg">
         <defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>
         <rect width="1" height="1" fill="url(#g)"/>
         <rect width="1" height="1" fill="url(https://evil.example/x.svg#g)"/>
       </svg>`,
    );
    expect(out).toContain('fill="url(#g)"');
    expect(out).not.toContain('evil.example');
  });

  it('keeps a local <use> reference and drops a remote one', () => {
    const out = sanitise(
      `<svg xmlns="http://www.w3.org/2000/svg">
         <use href="#local"/><use href="https://evil.example/x.svg#remote"/>
       </svg>`,
    );
    expect(out).toContain('href="#local"');
    expect(out).not.toContain('evil.example');
    // Exactly one `<use>` survives: the one whose reference was dropped draws nothing, so
    // it is removed rather than left as a confusing empty husk in the output.
    expect(out.match(/<use/g)).toHaveLength(1);
  });

  it('refuses a document whose root is not <svg>', () => {
    expect(() => sanitise('<html><body>hello</body></html>')).toThrow();
  });

  it('refuses unquoted attribute values rather than trying to interpret them', () => {
    expect(() => sanitise('<svg xmlns=http://www.w3.org/2000/svg></svg>')).toThrow();
  });

  it('re-escapes CDATA so it cannot re-open as markup', () => {
    const out = sanitise(
      `<svg xmlns="http://www.w3.org/2000/svg"><title><![CDATA[<script>alert(1)</script>]]></title></svg>`,
    );
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('drops an unknown element together with its subtree, never unwrapping it', () => {
    const out = sanitise(
      `<svg xmlns="http://www.w3.org/2000/svg"><switch><rect width="1" height="1"/></switch></svg>`,
    );
    expect(out).not.toContain('switch');
    // Unwrapping would have kept the rect, and would have kept the HTML inside a
    // foreignObject too. It does not.
    expect(out).not.toContain('rect');
  });

  it('restores a missing xmlns so the result actually renders', () => {
    expect(sanitise('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toContain(
      'xmlns="http://www.w3.org/2000/svg"',
    );
  });
});
