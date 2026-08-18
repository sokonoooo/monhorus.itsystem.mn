import { describe, expect, it } from 'vitest';

import {
  formatAttributeValue,
  isAttributeFilled,
  mergeAttributeValues,
  missingRequiredAttributes,
  validateAttributeValues,
  type ObjectTypeAttributeDto,
} from './object-type-attribute';

/**
 * The contract of the per-type attribute rules (requirements 4.1).
 *
 * These functions are the ONLY implementation of "is this a valid answer": the report form
 * and the registration form both run them before submitting, and the object service runs them
 * before writing. Replacing a compile-time guarantee with a runtime check is what the feature
 * costs, and this file is what buys the guarantee back — accept, reject, and the exact error
 * key, for every declared value type.
 */

const fuse: ObjectTypeAttributeDto = {
  key: 'fuse',
  label: 'Хайлмал хамгаалалт',
  type: 'SELECT',
  required: true,
  options: [
    { value: 'FUSED', label: 'Хайлмалтай' },
    { value: 'NOT_FUSED', label: 'Хайлмалгүй' },
  ],
};

const serial: ObjectTypeAttributeDto = {
  key: 'serial',
  label: 'Сериал дугаар',
  type: 'TEXT',
  required: false,
  options: [],
};

const poles: ObjectTypeAttributeDto = {
  key: 'poles',
  label: 'Туйлын тоо',
  type: 'NUMBER',
  required: false,
  options: [],
};

const sealed: ObjectTypeAttributeDto = {
  key: 'sealed',
  label: 'Лацдсан эсэх',
  type: 'BOOLEAN',
  required: true,
  options: [],
};

describe('isAttributeFilled', () => {
  it('treats false as an answer, not as an absence', () => {
    // The whole reason this is not a truthiness check: a required yes/no answered "Үгүй" is
    // complete, and falsiness would make recording a no impossible.
    expect(isAttributeFilled(false)).toBe(true);
    expect(isAttributeFilled(0)).toBe(true);
  });

  it('treats nothing, null and blank text as unanswered', () => {
    expect(isAttributeFilled(undefined)).toBe(false);
    expect(isAttributeFilled(null)).toBe(false);
    expect(isAttributeFilled('')).toBe(false);
    expect(isAttributeFilled('   ')).toBe(false);
  });
});

describe('validateAttributeValues', () => {
  it('accepts a complete, well-typed set', () => {
    expect(
      validateAttributeValues([fuse, serial, poles, sealed], {
        fuse: 'FUSED',
        serial: 'AB-1200',
        poles: 3,
        sealed: false,
      }),
    ).toEqual([]);
  });

  it('accepts an object with no declared attributes at all', () => {
    // The path every type registered before this feature existed takes.
    expect(validateAttributeValues([], {})).toEqual([]);
  });

  it('names a missing required attribute under its own field key', () => {
    const issues = validateAttributeValues([fuse], {});

    expect(issues).toHaveLength(1);
    // The dotted path is the contract with both the forms' error maps and the API's
    // FieldIssue shape; a change here silently detaches every message from its input.
    expect(issues[0]?.field).toBe('attributeValues.fuse');
    expect(issues[0]?.message).toContain('Хайлмал хамгаалалт');
  });

  it('leaves a missing optional attribute alone', () => {
    expect(validateAttributeValues([serial], {})).toEqual([]);
  });

  it('reports every failure rather than stopping at the first', () => {
    const issues = validateAttributeValues([fuse, sealed], {});

    expect(issues.map((issue) => issue.field)).toEqual([
      'attributeValues.fuse',
      'attributeValues.sealed',
    ]);
  });

  describe('SELECT', () => {
    it('refuses a value that is not one of the options', () => {
      const issues = validateAttributeValues([fuse], { fuse: 'MELTED' });

      expect(issues).toHaveLength(1);
      expect(issues[0]?.field).toBe('attributeValues.fuse');
      // The message lists what would have been accepted, so the user is not left guessing.
      expect(issues[0]?.message).toContain('Хайлмалтай');
    });

    it('refuses a non-string', () => {
      expect(validateAttributeValues([fuse], { fuse: 3 })).toHaveLength(1);
    });
  });

  describe('NUMBER', () => {
    it('accepts zero and a negative', () => {
      expect(validateAttributeValues([poles], { poles: 0 })).toEqual([]);
      expect(validateAttributeValues([poles], { poles: -4 })).toEqual([]);
    });

    it('refuses the raw text of an input box', () => {
      // A client that forgot to parse its number field. Caught here rather than becoming a
      // string in the database that every later reader has to defend against.
      const issues = validateAttributeValues([poles], { poles: '3' });

      expect(issues).toHaveLength(1);
      expect(issues[0]?.field).toBe('attributeValues.poles');
    });

    it('refuses NaN and infinity', () => {
      expect(validateAttributeValues([poles], { poles: Number.NaN })).toHaveLength(1);
      expect(validateAttributeValues([poles], { poles: Number.POSITIVE_INFINITY })).toHaveLength(1);
    });

    it('refuses a magnitude that cannot round-trip through JSON', () => {
      expect(validateAttributeValues([poles], { poles: 1e15 })).toHaveLength(1);
    });
  });

  describe('TEXT', () => {
    it('refuses text past the length cap', () => {
      const issues = validateAttributeValues([serial], { serial: 'a'.repeat(501) });

      expect(issues).toHaveLength(1);
      expect(issues[0]?.field).toBe('attributeValues.serial');
    });

    it('refuses a non-string', () => {
      expect(validateAttributeValues([serial], { serial: 12 })).toHaveLength(1);
    });
  });

  describe('BOOLEAN', () => {
    it('accepts a required false', () => {
      expect(validateAttributeValues([sealed], { sealed: false })).toEqual([]);
    });

    it('refuses the string "false"', () => {
      // Every non-empty string is truthy, so a stored `'false'` would read as a yes forever.
      const issues = validateAttributeValues([sealed], { sealed: 'false' });

      expect(issues).toHaveLength(1);
      expect(issues[0]?.field).toBe('attributeValues.sealed');
    });
  });

  it('refuses a key the type does not declare, rather than dropping it', () => {
    // Silently discarding would store an object the user believes carries a value it does
    // not — the same choice the strict discriminated union makes about a stray 4.2 block.
    const issues = validateAttributeValues([fuse], { fuse: 'FUSED', colour: 'RED' });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('attributeValues.colour');
  });
});

describe('mergeAttributeValues', () => {
  it('stores what was sent for a declared attribute', () => {
    expect(mergeAttributeValues([fuse], {}, { fuse: 'FUSED' })).toEqual({ fuse: 'FUSED' });
  });

  it('clears a declared attribute that arrives blank', () => {
    // Absent means cleared for a declared key. Without this, a value entered by mistake
    // could never be removed: an omitted key and an emptied one look identical on the wire.
    expect(mergeAttributeValues([serial], { serial: 'AB-1200' }, {})).toEqual({});
  });

  it('keeps the value of an attribute the type no longer declares', () => {
    // The preservation guarantee, and what makes it safe for two different forms to write
    // this bag: neither can destroy what it has never heard of.
    expect(
      mergeAttributeValues([fuse], { fuse: 'FUSED', separator: 'WITH' }, { fuse: 'NOT_FUSED' }),
    ).toEqual({ fuse: 'NOT_FUSED', separator: 'WITH' });
  });

  it('drops blanks so the stored bag stays sparse', () => {
    expect(mergeAttributeValues([fuse, serial], {}, { fuse: 'FUSED', serial: '' })).toEqual({
      fuse: 'FUSED',
    });
  });

  it('trims stored text', () => {
    expect(mergeAttributeValues([serial], {}, { serial: '  AB-1200  ' })).toEqual({
      serial: 'AB-1200',
    });
  });

  it('stores a false rather than dropping it', () => {
    expect(mergeAttributeValues([sealed], {}, { sealed: false })).toEqual({ sealed: false });
  });
});

describe('formatAttributeValue', () => {
  it('shows a SELECT by its label, not its stored value', () => {
    expect(formatAttributeValue(fuse, 'FUSED')).toBe('Хайлмалтай');
  });

  it('falls back to the raw value when its option was deleted', () => {
    // Still what was recorded. Showing the key beats showing nothing.
    expect(formatAttributeValue(fuse, 'MELTED')).toBe('MELTED');
  });

  it('spells a boolean in Mongolian', () => {
    expect(formatAttributeValue(sealed, true)).toBe('Тийм');
    expect(formatAttributeValue(sealed, false)).toBe('Үгүй');
  });

  it('returns null for an unanswered attribute so the caller decides how it reads', () => {
    expect(formatAttributeValue(serial, undefined)).toBeNull();
  });
});

describe('missingRequiredAttributes', () => {
  it('lists the required attributes an object has not answered', () => {
    // Read-time only, and never an error: an object registered before an attribute existed
    // is legitimately incomplete against it, which is what lets a screen mark the gap.
    expect(missingRequiredAttributes([fuse, serial, sealed], {}).map((def) => def.key)).toEqual([
      'fuse',
      'sealed',
    ]);
  });

  it('does not count a false as missing', () => {
    expect(missingRequiredAttributes([sealed], { sealed: false })).toEqual([]);
  });
});
