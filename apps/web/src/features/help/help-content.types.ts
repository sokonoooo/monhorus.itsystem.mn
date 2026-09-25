/**
 * The shape of a page's help entry.
 *
 * Nine named sections rather than a free list of headings, because the value of this
 * feature is that every page answers the SAME questions in the SAME order. A free-form
 * structure would drift within a week and leave the reader guessing where "what am I not
 * allowed to change" lives on this particular screen.
 *
 * Every section except `purpose` is optional, and an absent one is not rendered. A list
 * page has no editable fields; a read-only report has no steps. Inventing a sentence to
 * fill the gap is how help text becomes noise people learn to skip.
 */

/** One field, and what it actually means - not a restatement of its label. */
export interface HelpField {
  name: string;
  note: string;
}

/** A pointer to another screen, so "related" is navigable rather than described. */
export interface HelpLink {
  label: string;
  to: string;
}

export interface PageHelp {
  /** Shown as the panel's heading. The page's own name, in the words the UI uses. */
  title: string;

  /** Энэ хуудсын зорилго — one or two sentences on why the page exists. Required. */
  purpose: string;

  /** Юу хийдэг вэ? — what a reader can actually do here. */
  actions?: readonly string[];

  /** Хэн ашигладаг вэ? — the roles this page is for, and what each does with it. */
  audience?: readonly string[];

  /** Хэзээ ашиглах вэ? — the moment in the workflow this screen belongs to. */
  timing?: readonly string[];

  /** Засаж болох талбарууд — fields that can be changed, and what changing one means. */
  editableFields?: readonly HelpField[];

  /** Засаж болохгүй талбарууд — fields that cannot, AND why. The why is the point. */
  readOnlyFields?: readonly HelpField[];

  /** Алхам алхмаар — the main task, numbered, in the order it is done. */
  steps?: readonly string[];

  /** Холбоотой мэдээлэл — where this page leads or what feeds it. */
  related?: readonly HelpLink[];

  /** Анхаарах зүйлс — rules and consequences worth knowing BEFORE acting. */
  warnings?: readonly string[];
}

/**
 * Route pattern -> help, e.g. '/employees/:employeeId'.
 *
 * Keyed by route rather than by component because several components serve materially
 * different screens: `PlannedWorkFormPage` is four routes, and "create planned work" and
 * "edit planned work as a customer" do not want the same instructions.
 */
export type HelpRegistry = Readonly<Record<string, PageHelp>>;
