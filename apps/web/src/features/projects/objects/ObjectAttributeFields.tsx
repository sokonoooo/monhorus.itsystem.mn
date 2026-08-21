import { attributeFieldPath, type ObjectTypeAttributeDto } from '@monhorus/shared';
import type { ReactElement } from 'react';

import { Field, SelectInput, TextInput } from '../../employees/FormControls';

/**
 * The inputs for whatever an equipment TYPE declares (requirements 4.1).
 *
 * Driven entirely by definitions the API supplies — nothing here names an attribute, a type
 * or a category, so adding a field to Автомат таслуур is an edit in Тоноглолын төрөл and not
 * a change to any screen.
 *
 * ONE RENDERER, TWO SCREENS. The Үнэлгээ бүртгэх form asks these questions when a report is
 * written in front of the equipment, and the registration form asks them when equipment is
 * first recorded. They have to offer the same controls and refuse the same answers, so they
 * share this rather than each growing their own copy — the same reasoning as the shared
 * `validateAttributeValues` behind them.
 */

/**
 * A stored value as its form control holds it.
 *
 * Everything becomes a string, a boolean included, because a half-typed "23." is a legitimate
 * state of a number box and coercing on every keystroke eats the decimal point. Parsed once,
 * by `toAttributePayload`, on submit.
 */
export function toAttributeDrafts(
  defs: readonly ObjectTypeAttributeDto[],
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const def of defs) {
    const value = values[def.key];
    drafts[def.key] = value === undefined || value === null ? '' : String(value);
  }
  return drafts;
}

/**
 * The drafts as the API wants them: parsed to the declared type, blanks omitted.
 *
 * ONLY THE KEYS THE CURRENT TYPE DECLARES. Changing the type on an edit leaves the previous
 * type's drafts sitting in state — deliberately, so switching back does not lose what was
 * typed — and reading through the definitions is what stops them being sent. The backend
 * refuses an undeclared key rather than dropping it, so this is not a nicety.
 *
 * A blank is omitted rather than sent as `''`: absent and empty mean the same thing to
 * `validateAttributeValues`, and omitting keeps the stored bag sparse.
 */
export function toAttributePayload(
  defs: readonly ObjectTypeAttributeDto[],
  drafts: Readonly<Record<string, string>>,
): Record<string, string | number | boolean> {
  const payload: Record<string, string | number | boolean> = {};
  for (const def of defs) {
    const raw = (drafts[def.key] ?? '').trim();
    if (raw === '') continue;

    if (def.type === 'NUMBER') {
      // NaN for unparseable text, which `validateAttributeValues` names before anything is
      // sent. It must not survive as far as the request: JSON has no NaN and it would arrive
      // as a null, turning a clear message into a generic type error.
      payload[def.key] = Number(raw);
    } else if (def.type === 'BOOLEAN') {
      payload[def.key] = raw === 'true';
    } else {
      payload[def.key] = raw;
    }
  }
  return payload;
}

interface Props {
  attributes: readonly ObjectTypeAttributeDto[];
  drafts: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
  /** Keyed `attributeValues.<key>`, as both the shared validator and the API report them. */
  fieldErrors: Record<string, string>;
}

export function ObjectAttributeFields({
  attributes,
  drafts,
  onChange,
  disabled,
  fieldErrors,
}: Props): ReactElement {
  return (
    <>
      {attributes.map((attribute) => {
        const draft = drafts[attribute.key] ?? '';

        return (
          <Field
            key={attribute.key}
            label={attribute.label}
            required={attribute.required}
            error={fieldErrors[attributeFieldPath(attribute.key)]}
          >
            {attribute.type === 'SELECT' ? (
              <SelectInput
                value={draft}
                onChange={(next) => onChange(attribute.key, next)}
                disabled={disabled}
                options={[
                  { value: '', label: 'Сонгоно уу' },
                  ...attribute.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  })),
                ]}
              />
            ) : attribute.type === 'BOOLEAN' ? (
              /*
                A select rather than a checkbox, so "not answered" stays expressible. An
                unticked checkbox is indistinguishable from a deliberate "Үгүй", which would
                make `required` on a yes/no satisfiable by never looking at the field.
              */
              <SelectInput
                value={draft}
                onChange={(next) => onChange(attribute.key, next)}
                disabled={disabled}
                options={[
                  { value: '', label: 'Сонгоно уу' },
                  { value: 'true', label: 'Тийм' },
                  { value: 'false', label: 'Үгүй' },
                ]}
              />
            ) : (
              <TextInput
                type={attribute.type === 'NUMBER' ? 'number' : 'text'}
                value={draft}
                onChange={(next) => onChange(attribute.key, next)}
                disabled={disabled}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}
