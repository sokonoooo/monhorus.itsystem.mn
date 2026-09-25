import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Drawer } from '../../components/ui/Drawer';
import type { HelpField, HelpLink, PageHelp } from './help-content.types';

/**
 * Renders one page's help.
 *
 * A Drawer rather than a Modal: help is read ALONGSIDE the screen it describes, and a
 * centred dialog covers the thing the reader is trying to understand. The wide variant,
 * because numbered steps wrapped to four words a line are harder to follow than the task
 * they describe.
 *
 * Sections render only when present. The order is fixed and identical on every page, so
 * somebody who has read one help panel knows where to look in the next.
 */

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: readonly string[] }): ReactElement {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Steps({ items }: { items: readonly string[] }): ReactElement {
  return (
    <ol className="list-decimal space-y-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

function Fields({ items }: { items: readonly HelpField[] }): ReactElement {
  return (
    <dl className="space-y-2">
      {items.map((field) => (
        <div key={field.name}>
          <dt className="font-medium text-slate-900">{field.name}</dt>
          <dd className="text-slate-700">{field.note}</dd>
        </div>
      ))}
    </dl>
  );
}

function Links({ items, onNavigate }: { items: readonly HelpLink[]; onNavigate: () => void }) {
  return (
    <ul className="space-y-1.5">
      {items.map((link) => (
        <li key={link.to}>
          {/* Closes on navigation: a panel describing the page you just left is worse
              than no panel, because it reads as though it describes the new one. */}
          <Link
            to={link.to}
            onClick={onNavigate}
            className="text-blue-700 underline underline-offset-2 hover:text-blue-800"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
  help: PageHelp | null;
}

export function HelpPanel({ open, onClose, help }: HelpPanelProps): ReactElement {
  return (
    <Drawer open={open} onClose={onClose} title={help ? `Тусламж: ${help.title}` : 'Тусламж'} width="lg">
      {help === null ? (
        /*
          Said plainly rather than filled with something generic. Generic help on a specific
          screen is worse than none: it teaches the reader that the button is not worth
          pressing, and they stop pressing it on the pages where it would have helped.
        */
        <p className="text-sm text-slate-600">
          Энэ хуудсанд тусгайлсан тусламж хараахан бэлдээгүй байна.
        </p>
      ) : (
        <div className="space-y-4">
          <Section title="Энэ хуудсын зорилго">
            <p>{help.purpose}</p>
          </Section>

          {help.actions && (
            <Section title="Юу хийдэг вэ?">
              <Bullets items={help.actions} />
            </Section>
          )}

          {help.audience && (
            <Section title="Хэн ашигладаг вэ?">
              <Bullets items={help.audience} />
            </Section>
          )}

          {help.timing && (
            <Section title="Хэзээ ашиглах вэ?">
              <Bullets items={help.timing} />
            </Section>
          )}

          {help.steps && (
            <Section title="Алхам алхмаар">
              <Steps items={help.steps} />
            </Section>
          )}

          {help.editableFields && (
            <Section title="Засаж болох талбарууд">
              <Fields items={help.editableFields} />
            </Section>
          )}

          {help.readOnlyFields && (
            <Section title="Засаж болохгүй талбарууд">
              <Fields items={help.readOnlyFields} />
            </Section>
          )}

          {help.warnings && (
            <Section title="Анхаарах зүйлс">
              <Bullets items={help.warnings} />
            </Section>
          )}

          {help.related && (
            <Section title="Холбоотой мэдээлэл">
              <Links items={help.related} onNavigate={onClose} />
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}
