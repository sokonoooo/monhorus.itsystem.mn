import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE INVARIANT THAT KEEPS THE CHOKEPOINT A CHOKEPOINT.
 *
 * Every rule in `role-assignment.service.ts` is worth exactly nothing if a future
 * contributor adds an eighth role-write somewhere else. That is not a hypothetical: it is
 * the history of this codebase. Seven separate places wrote a user's roles, each with its
 * own partial (and mostly absent) idea of the rules, and the result was an endpoint that
 * let an actor holding only `rbac.manage` assign SYSTEM_ADMIN to itself.
 *
 * A code review cannot be relied on to catch the eighth, because `user.roles = roleIds`
 * looks completely innocuous at the call site. So this test reads the SOURCE and fails the
 * build when a write appears outside the approved service.
 *
 * It scans for four shapes rather than one, because the bypass does not have to be an
 * assignment:
 *
 *   1. Assigning or mutating a `.roles` property in place.
 *   2. Constructing a User document — `User.create(...)` or `new User(...)` — which writes
 *      `roles` whether or not the literal mentions it (omitting it writes the schema
 *      default, and an account with no roles resolves to an EMPTY permission set).
 *   3. Any Mongo-level write through the User model, which can set `roles` without the word
 *      `roles` appearing anywhere near the call.
 *   4. An update operator naming `roles`, which catches the write even if it goes through
 *      some other handle on the collection.
 *
 * Comments and their contents are stripped before scanning, so the extensive prose in these
 * modules — much of which quotes the very patterns being banned — cannot trip it, and a
 * contributor cannot smuggle a write past it by commenting the line either.
 */

const BACKEND_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');

/**
 * The paths permitted to write a user's roles, each with the reason it is permitted.
 *
 * Deliberately spelled as exact repo-relative paths and not as directory prefixes or
 * patterns. A prefix such as `src/modules/rbac/` would silently bless any future file
 * dropped into that folder, which is precisely the drift this test exists to prevent. The
 * only pattern-based entry is the `.test.ts` suffix, and that is checked separately.
 */
const ALLOWED_WRITERS: ReadonlyArray<{ path: string; because: string }> = [
  {
    path: 'src/modules/rbac/role-assignment.service.ts',
    because:
      'THE chokepoint. Every rule — the delegation ceiling, the protected-role gate, the ' +
      'self-target refusal, tier/role coherence and the last-administrator rule — is ' +
      'stated here and nowhere else.',
  },
  {
    path: 'src/scripts/bootstrap-head-admin.ts',
    because:
      'Creates the very first administrator on an empty installation. It runs from a shell ' +
      'with no authenticated actor, because the operator IS the actor, and it refuses to ' +
      'run at all once a head_admin exists. Not reachable over the network.',
  },
  {
    path: 'src/scripts/backfill-user-roles.ts',
    because:
      'A one-off migration for accounts written before the tier default existed. It only ' +
      'ever writes to accounts whose roles are empty or absent, so it can restore an ' +
      'account but never widen one. Not reachable over the network.',
  },
  {
    path: 'src/scripts/seed-dev-data.ts',
    because:
      'The development seed, and the third of the three operator scripts the chokepoint ' +
      'documents as its exception. It provisions a technician login for each ACTIVE seeded ' +
      'employee so the employee mobile app has something to sign in as, and it takes the ' +
      'role set from `resolveDefaultRoleIds(\'technician\')` — the same function the runtime ' +
      'uses for an account provisioned with no explicit selection — so it grants the tier ' +
      'default and can never name a role of its own. It refuses to run with ' +
      'NODE_ENV=production and is not reachable over the network.',
  },
  {
    path: 'src/test/helpers.ts',
    because:
      'Builds fixture accounts directly, which is the point: a test that had to go through ' +
      'the policy to construct its own attacker could not test the policy.',
  },
];

const ALLOWED_PATHS = new Set(ALLOWED_WRITERS.map((entry) => entry.path));

/** Every `.ts` file under `src/`, as repo-relative POSIX-ish paths. */
function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, found);
      continue;
    }
    if (entry.endsWith('.ts')) {
      found.push(relative(BACKEND_ROOT, full).split(sep).join('/'));
    }
  }
  return found;
}

/**
 * Removes block comments, line comments and string literals.
 *
 * String literals go too because an audit `reason` or an error message could otherwise
 * contain a banned phrase and fail an honest build. Replacement preserves newlines so a
 * reported line number still points at the right line.
 */
function stripNonCode(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (match) => match.replace(/[^\n]/g, ' '),
  );
}

/** In-place array mutators. `map`, `filter` and friends are reads and are not listed. */
const ARRAY_MUTATORS = 'push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set';

/**
 * Shapes that are a role write wherever they appear, with no argument to examine.
 *
 * Constructing a User is on this list even though the literal need not mention `roles`:
 * omitting the field writes the schema default, and an account with no roles resolves to an
 * EMPTY permission set — a provisioned account that every guard refuses. That is a role
 * decision being made by silence, which is exactly what the chokepoint exists to own.
 */
const UNCONDITIONAL_SHAPES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: "assignment to a '.roles' property",
    pattern: /\.roles\s*(?:\|\||\?\?|&&)?=(?!=)/g,
  },
  {
    label: "in-place mutation of a '.roles' array",
    pattern: new RegExp(String.raw`\.roles\s*\.\s*(?:${ARRAY_MUTATORS})\s*\(`, 'g'),
  },
  {
    label: 'construction of a User document',
    pattern: /\bUser\s*\.\s*create\s*\(|\bnew\s+User\s*\(/g,
  },
];

/**
 * Mongo-level writes through the User model, which are examined rather than banned outright.
 *
 * A blanket ban would be wrong: `auth.service.ts` legitimately resets `failedLoginAttempts`,
 * `lockedUntil` and `lastLoginAt` on login with an inline `$set` that cannot touch `roles`.
 * Banning that would push a real, correct write onto the allowlist, and every entry on the
 * allowlist is a place the invariant no longer protects.
 *
 * So the call's ARGUMENTS decide, on two rules that together leave no gap:
 *
 *   1. The arguments mention `roles` anywhere — the obvious case.
 *   2. The arguments contain no inline update operator at all. This is the subtle one and it
 *      is the reason this is not just a `\broles\b` grep: an update document held in a
 *      variable is opaque to a source scan, so `User.updateOne(filter, update)` with the
 *      operators out of sight could set anything. Rather than trust it, the indirection
 *      itself is refused. `insertMany` and `bulkWrite` fall out of this rule naturally,
 *      since neither takes an update operator and both can write whole documents.
 */
const USER_MODEL_WRITE =
  /\bUser\s*\.\s*(?:updateOne|updateMany|replaceOne|insertMany|bulkWrite|findByIdAndUpdate|findOneAndUpdate|findOneAndReplace)\s*\(/g;

const INLINE_UPDATE_OPERATOR =
  /\$(?:set|unset|setOnInsert|push|addToSet|pull|pullAll|pop|inc|mul|rename|min|max|currentDate)\s*:/;

/**
 * The text between a call's parentheses, matched by depth.
 *
 * Strings and comments are already blanked out by `stripNonCode`, so a parenthesis inside
 * either cannot unbalance the count. An unterminated call reads to the end of the file,
 * which flags rather than skips — the safe direction for a security check.
 */
function argumentsOf(source: string, openParen: number): string {
  let depth = 0;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, index);
    }
  }
  return source.slice(openParen + 1);
}

interface Violation {
  file: string;
  line: number;
  shape: string;
  code: string;
}

function scan(file: string): Violation[] {
  const text = stripNonCode(readFileSync(join(BACKEND_ROOT, file), 'utf8'));
  const lines = text.split('\n');
  const violations: Violation[] = [];

  const lineOf = (index: number): number => text.slice(0, index).split('\n').length;
  const record = (index: number, shape: string): void => {
    const line = lineOf(index);
    violations.push({ file, line, shape, code: (lines[line - 1] ?? '').trim() });
  };

  for (const shape of UNCONDITIONAL_SHAPES) {
    for (const match of text.matchAll(shape.pattern)) {
      record(match.index, shape.label);
    }
  }

  for (const match of text.matchAll(USER_MODEL_WRITE)) {
    const args = argumentsOf(text, match.index + match[0].length - 1);
    if (/\broles\b/.test(args)) {
      record(match.index, "a Mongo-level write through the User model naming 'roles'");
    } else if (!INLINE_UPDATE_OPERATOR.test(args)) {
      record(
        match.index,
        'a Mongo-level write through the User model whose update document is not inline, ' +
          'so this scan cannot prove it leaves roles alone',
      );
    }
  }

  return violations;
}

describe('role-write invariant', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  it('finds the source tree it is supposed to be scanning', () => {
    // Guards against the scan silently passing because it walked an empty or wrong
    // directory — a green test that checked nothing would be worse than no test.
    expect(sourceFiles.length).toBeGreaterThan(50);
    expect(sourceFiles).toContain('src/modules/rbac/role-assignment.service.ts');
    expect(sourceFiles).toContain('src/modules/user/user.service.ts');
    expect(sourceFiles).toContain('src/modules/employee/employee-access.service.ts');
  });

  it('lists only allowlisted paths that actually exist', () => {
    // A renamed or deleted file would otherwise leave a dead entry behind, and the next
    // contributor would read it as evidence that some other file is blessed.
    for (const entry of ALLOWED_WRITERS) {
      expect(sourceFiles, `allowlisted path is missing: ${entry.path}`).toContain(entry.path);
    }
  });

  /**
   * The invariant itself.
   *
   * If this fails, do NOT add the offending file to the allowlist. Route the write through
   * `applyRoleAssignment` or `createAccountWithRoles` instead. The allowlist is for code
   * that runs with no HTTP actor at all — operator scripts and test fixtures — and adding a
   * request-serving module to it reintroduces exactly the class of hole this exists to
   * close.
   */
  it('permits no write to a user’s roles outside the chokepoint', () => {
    const violations = sourceFiles
      .filter((file) => !ALLOWED_PATHS.has(file) && !file.endsWith('.test.ts'))
      .flatMap(scan);

    const report = violations
      .map((entry) => `  ${entry.file}:${entry.line}  [${entry.shape}]  ${entry.code}`)
      .join('\n');

    expect(violations, `Unapproved role writes found:\n${report}`).toEqual([]);
  });

  /**
   * The other half: the chokepoint must still BE one.
   *
   * A refactor that split the write across several helpers, or that quietly stopped writing
   * at all, would leave the scan above green while the guarantee evaporated. So the exact
   * count is pinned: one assignment (`applyRoleAssignment`) and one construction
   * (`createAccountWithRoles`).
   */
  it('keeps exactly one role assignment and one account construction in the chokepoint', () => {
    const service = stripNonCode(
      readFileSync(join(BACKEND_ROOT, 'src/modules/rbac/role-assignment.service.ts'), 'utf8'),
    );

    expect(service.match(/\.roles\s*=(?!=)/g)).toHaveLength(1);
    expect(service.match(/\bUser\s*\.\s*create\s*\(/g)).toHaveLength(1);
  });

  /**
   * The request-serving modules that used to hold their own copies of the rules.
   *
   * Named individually and asserted clean, so that removing one of them from the scan — by
   * moving it, by adding a `.test.ts` suffix, or by any other accident — is itself a
   * failure rather than a silent loss of coverage.
   */
  it('leaves no role write in the modules that previously had their own', () => {
    const previouslyGuilty = [
      'src/modules/user/user.service.ts',
      'src/modules/rbac/rbac.routes.ts',
      'src/modules/rbac/rbac.service.ts',
      'src/modules/employee/employee-access.service.ts',
    ];

    for (const file of previouslyGuilty) {
      expect(sourceFiles, `expected to scan ${file}`).toContain(file);
      expect(scan(file), `${file} writes a user's roles directly`).toEqual([]);
    }
  });
});
