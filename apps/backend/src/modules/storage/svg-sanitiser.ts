import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

/**
 * A strict, allowlist-only SVG sanitiser.
 *
 * WHY HAND-WRITTEN RATHER THAN A LIBRARY. The obvious choice is DOMPurify, but DOMPurify is
 * a browser library: on Node it needs a full DOM, which means pulling `jsdom` — an HTML
 * parser, a CSS parser, a URL implementation and a partial script host — into a service
 * whose entire use for it is to accept a few kilobytes of icon markup from an administrator.
 * That is a large, actively-exploited attack surface bought to defend a tiny one, and it
 * carries the same mutation-XSS class of bug that comes from sanitising in an HTML parser
 * and re-serialising for an XML consumer. `sanitize-html` has the same mismatch: it parses
 * HTML, and this file is served as `image/svg+xml`, which browsers parse as XML.
 *
 * The safety here does not come from cleverness, it comes from three properties:
 *
 *   1. PARSE, ALLOWLIST, RE-SERIALISE. Nothing is edited in place and no regex is run over
 *      the markup to remove things. The input is parsed into a tree, the tree is rebuilt
 *      keeping only what is explicitly permitted, and the output is written from scratch
 *      with full escaping. Anything the parser did not understand is not in the tree and
 *      therefore cannot be in the output.
 *   2. STRICTNESS OVER REPAIR. A document that does not parse cleanly as the small XML
 *      subset below is REFUSED, not fixed. Tag-soup recovery is where sanitisers get
 *      broken; there is no recovery here. A PNG renamed `.svg` fails at the first byte.
 *   3. DENY BY DEFAULT. An unknown element is dropped together with its whole subtree — not
 *      unwrapped, because unwrapping `<foreignObject>` would keep the HTML inside it. An
 *      unknown attribute is dropped. There is no denylist to keep up to date.
 *
 * NOTHING IS ADDED TO package.json.
 *
 * What the output cannot contain, by construction: `<script>`, `<foreignObject>`, `<a>`,
 * `<image>`, `<iframe>`, any animation element, any `on*` handler, any `javascript:`,
 * `vbscript:` or `data:` URL, any off-origin `href`/`xlink:href`, any `url()` that is not a
 * local `#fragment`, any `@import`, any DOCTYPE, and any entity declaration or reference
 * beyond the five XML predefined ones.
 */

// -- Limits ------------------------------------------------------------------

/** Nesting depth. A real icon is three or four deep; this is well past pathological. */
const MAX_DEPTH = 40;
/** Total elements. Cheap upper bound on parser work, independent of the byte limit. */
const MAX_ELEMENTS = 4000;

// -- Allowlists --------------------------------------------------------------

/**
 * Permitted elements. Names are compared EXACTLY, never case-folded, because the document
 * is served as `image/svg+xml` and browsers parse that as XML, where `<SCRIPT>` is a
 * different (and unknown, and therefore dropped) element from `<script>`.
 *
 * Absences worth stating: `<a>` (navigation inside an icon is not a feature), `<image>`
 * (an external or `data:` reference), `<foreignObject>` (an HTML escape hatch), `<filter>`
 * and its `<feImage>` (another external reference), `<animate>`/`<set>` (they can rewrite
 * an attribute after sanitising), `<switch>`, `<metadata>` and `<script>`.
 */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
]);

/** The only elements whose text content survives. Everywhere else text is dropped. */
const TEXT_BEARING_ELEMENTS = new Set(['title', 'desc', 'text', 'tspan', 'style']);

/** Presentation attributes permitted on any allowed element. */
const GLOBAL_ATTRIBUTES = new Set([
  'id',
  'class',
  'style',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'color',
  'display',
  'visibility',
  'clip-path',
  'clip-rule',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'vector-effect',
  'shape-rendering',
  'paint-order',
  'xml:space',
]);

/** Geometry and structural attributes, per element. */
const ATTRIBUTES_BY_ELEMENT: Readonly<Record<string, readonly string[]>> = {
  svg: ['xmlns', 'xmlns:xlink', 'version', 'baseProfile', 'viewBox', 'width', 'height', 'x', 'y', 'preserveAspectRatio'],
  symbol: ['viewBox', 'preserveAspectRatio', 'x', 'y', 'width', 'height', 'overflow'],
  use: ['x', 'y', 'width', 'height', 'href', 'xlink:href'],
  path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  text: ['x', 'y', 'dx', 'dy', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'dominant-baseline'],
  tspan: ['x', 'y', 'dx', 'dy', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'dominant-baseline'],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  clipPath: ['clipPathUnits'],
  mask: ['maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height'],
  pattern: ['patternUnits', 'patternContentUnits', 'patternTransform', 'x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'href', 'xlink:href'],
  marker: ['viewBox', 'preserveAspectRatio', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient', 'overflow'],
  style: ['type'],
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/** A reference that cannot leave the document: a bare fragment id. */
const LOCAL_FRAGMENT = /^#[A-Za-z_][\w.:-]*$/;

/** Attributes that name a document, and are therefore held to `LOCAL_FRAGMENT`. */
const REFERENCE_ATTRIBUTES = new Set(['href', 'xlink:href']);

// -- Parser ------------------------------------------------------------------

interface ParsedElement {
  name: string;
  attributes: [string, string][];
  children: ParsedNode[];
}

type ParsedNode = ParsedElement | { text: string };

function isElement(node: ParsedNode): node is ParsedElement {
  return 'name' in node;
}

function refuse(reason: string): never {
  throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'SVG файл танигдсангүй.', [
    { field: 'file', message: `Зөвшөөрөгдөөгүй SVG: ${reason}` },
  ]);
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_.:-]/;

/**
 * Decodes the five XML predefined entities and numeric character references, and REFUSES
 * anything else that starts with `&`.
 *
 * Decoding numeric references rather than passing them through is the point: `&#106;` is
 * `j`, and a checker that looked at the raw text would not see the `javascript:` that a
 * browser sees. Everything decoded here is re-escaped on the way out, so the round trip is
 * lossless and the checks below run on what the browser will actually resolve.
 *
 * A named entity that is not one of the five can only have come from a DTD, which this
 * parser refuses outright — so seeing one means the document is trying something, and the
 * answer is no.
 */
function decodeEntities(raw: string, where: string): string {
  if (!raw.includes('&')) return raw;

  let out = '';
  let index = 0;

  while (index < raw.length) {
    const amp = raw.indexOf('&', index);
    if (amp === -1) {
      out += raw.slice(index);
      break;
    }
    out += raw.slice(index, amp);

    const semicolon = raw.indexOf(';', amp);
    if (semicolon === -1 || semicolon - amp > 12) refuse(`${where} дотор бүтэн бус entity`);
    const body = raw.slice(amp + 1, semicolon);

    if (body === 'amp') out += '&';
    else if (body === 'lt') out += '<';
    else if (body === 'gt') out += '>';
    else if (body === 'quot') out += '"';
    else if (body === 'apos') out += "'";
    else if (/^#\d+$/.test(body)) out += codePoint(Number(body.slice(1)), where);
    else if (/^#[xX][\da-fA-F]+$/.test(body)) out += codePoint(parseInt(body.slice(2), 16), where);
    else refuse(`${where} дотор танигдаагүй entity "&${body};"`);

    index = semicolon + 1;
  }

  return out;
}

function codePoint(value: number, where: string): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) {
    refuse(`${where} дотор буруу тэмдэгтийн код`);
  }
  return String.fromCodePoint(value);
}

/**
 * Parses the small XML subset this accepts, and refuses everything else.
 *
 * Refused rather than skipped: `<!DOCTYPE` and `<!ENTITY` (the billion-laughs vector, and
 * the only way to smuggle an entity past `decodeEntities`), unquoted attribute values,
 * mismatched or unclosed tags, and any stray `<` or `&`. An icon produced by any real tool
 * satisfies all of this; a document that does not is not an icon.
 */
function parse(source: string): ParsedElement {
  let index = 0;
  let elementCount = 0;
  const stack: ParsedElement[] = [];
  const roots: ParsedElement[] = [];

  const push = (node: ParsedNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (isElement(node)) roots.push(node);
  };

  const readName = (): string => {
    const start = index;
    if (!NAME_START.test(source[index] ?? '')) refuse('нэр буруу');
    index += 1;
    while (index < source.length && NAME_CHAR.test(source[index] as string)) index += 1;
    return source.slice(start, index);
  };

  const skipWhitespace = (): void => {
    while (index < source.length && /\s/.test(source[index] as string)) index += 1;
  };

  while (index < source.length) {
    if (source[index] !== '<') {
      const next = source.indexOf('<', index);
      const end = next === -1 ? source.length : next;
      const text = source.slice(index, end);
      if (stack.length > 0) push({ text: decodeEntities(text, 'текст') });
      else if (text.trim() !== '') refuse('үндсэн элементийн гадна текст');
      index = end;
      continue;
    }

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end === -1) refuse('хаагдаагүй тайлбар');
      index = end + 3;
      continue;
    }

    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9);
      if (end === -1) refuse('хаагдаагүй CDATA');
      // Kept as ordinary text and re-escaped on output, so a CDATA block cannot smuggle
      // markup: the `<` inside one never survives as a `<`.
      if (stack.length > 0) push({ text: source.slice(index + 9, end) });
      index = end + 3;
      continue;
    }

    if (source.startsWith('<!', index)) {
      // DOCTYPE, ENTITY, NOTATION. Refused outright — an internal DTD subset is how a
      // document declares recursive entities, and there is no reason for an icon to carry one.
      refuse('DOCTYPE эсвэл entity тодорхойлолт');
    }

    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2);
      if (end === -1) refuse('хаагдаагүй processing instruction');
      index = end + 2;
      continue;
    }

    if (source.startsWith('</', index)) {
      index += 2;
      const name = readName();
      skipWhitespace();
      if (source[index] !== '>') refuse('хаах шошго буруу');
      index += 1;
      const open = stack.pop();
      if (!open || open.name !== name) refuse(`таарахгүй хаах шошго "${name}"`);
      continue;
    }

    // Start tag.
    index += 1;
    const name = readName();
    elementCount += 1;
    if (elementCount > MAX_ELEMENTS) refuse('хэт олон элемент');

    const element: ParsedElement = { name, attributes: [], children: [] };
    const seen = new Set<string>();

    for (;;) {
      skipWhitespace();
      const char = source[index];
      if (char === undefined) refuse('хаагдаагүй шошго');

      if (char === '>') {
        index += 1;
        push(element);
        stack.push(element);
        if (stack.length > MAX_DEPTH) refuse('хэт гүн бүтэц');
        break;
      }

      if (char === '/') {
        index += 1;
        if (source[index] !== '>') refuse('өөрөө хаагдах шошго буруу');
        index += 1;
        push(element);
        break;
      }

      const attributeName = readName();
      skipWhitespace();
      if (source[index] !== '=') refuse(`"${attributeName}" утгагүй атрибут`);
      index += 1;
      skipWhitespace();

      const quote = source[index];
      // Unquoted values are legal in HTML and not in XML, and they are the classic way to
      // hide a second attribute inside the first. Refused.
      if (quote !== '"' && quote !== "'") refuse(`"${attributeName}" хашилтгүй утга`);
      const valueEnd = source.indexOf(quote, index + 1);
      if (valueEnd === -1) refuse(`"${attributeName}" хаагдаагүй утга`);
      const value = decodeEntities(source.slice(index + 1, valueEnd), `"${attributeName}"`);
      index = valueEnd + 1;

      if (seen.has(attributeName)) refuse(`давхардсан атрибут "${attributeName}"`);
      seen.add(attributeName);
      element.attributes.push([attributeName, value]);
    }
  }

  if (stack.length > 0) refuse(`хаагдаагүй элемент "${stack[stack.length - 1]?.name}"`);
  if (roots.length !== 1) refuse('нэг үндсэн элемент байх ёстой');

  const root = roots[0] as ParsedElement;
  // The declared content type is not evidence; this is. A PNG, a ZIP or an HTML page never
  // reaches here — it fails in the parser — and an XML document that is not an SVG fails now.
  if (root.name !== 'svg') refuse('үндсэн элемент <svg> биш');
  return root;
}

// -- Allowlisting ------------------------------------------------------------

/**
 * Refuses any attribute value that could reach outside the document.
 *
 * Runs on the DECODED value, so `&#106;avascript:` has already become `javascript:` by the
 * time it is checked. Whitespace and control characters are stripped before the comparison
 * because `java\nscript:` is a URL a browser accepts and a naive `includes` does not.
 */
function valueIsSafe(value: string): boolean {
  const flattened = value.replace(/[\s\u0000-\u001f\u007f]/g, '').toLowerCase();

  if (
    flattened.includes('javascript:') ||
    flattened.includes('vbscript:') ||
    flattened.includes('data:') ||
    flattened.includes('expression(') ||
    flattened.includes('-moz-binding') ||
    flattened.includes('behavior:') ||
    flattened.includes('@import') ||
    // A CSS escape (`\6a avascript:`) is only ever an attempt to hide one of the above.
    flattened.includes('\\')
  ) {
    return false;
  }

  // `fill="url(#grad)"` and `clip-path="url(#clip)"` are legitimate and stay; every other
  // `url(` names a document this icon has no business fetching.
  let cursor = flattened.indexOf('url(');
  while (cursor !== -1) {
    const rest = flattened.slice(cursor + 4).replace(/^["']/, '');
    if (!rest.startsWith('#')) return false;
    cursor = flattened.indexOf('url(', cursor + 4);
  }

  return true;
}

function attributeIsAllowed(elementName: string, attributeName: string): boolean {
  if (GLOBAL_ATTRIBUTES.has(attributeName)) return true;
  return (ATTRIBUTES_BY_ELEMENT[elementName] ?? []).includes(attributeName);
}

/**
 * Stylesheet text is kept only when it is inert.
 *
 * `<style>` earns its place because every icon exported by Illustrator or Figma puts its
 * fills in a class rather than on the element, and dropping it would turn those icons into
 * black silhouettes. It is kept on an all-or-nothing basis: a stylesheet containing any of
 * the constructs below is dropped whole rather than edited, because editing CSS with string
 * surgery is exactly the kind of cleverness this module refuses to rely on.
 */
function styleSheetIsSafe(css: string): boolean {
  const flattened = css.replace(/[\s\u0000-\u001f\u007f]/g, '').toLowerCase();
  return (
    !flattened.includes('@import') &&
    !flattened.includes('@charset') &&
    !flattened.includes('url(') &&
    !flattened.includes('expression(') &&
    !flattened.includes('javascript:') &&
    !flattened.includes('vbscript:') &&
    !flattened.includes('data:') &&
    !flattened.includes('-moz-binding') &&
    !flattened.includes('behavior:') &&
    !flattened.includes('<') &&
    !flattened.includes('\\')
  );
}

function cleanAttributes(element: ParsedElement): [string, string][] {
  const kept: [string, string][] = [];

  for (const [name, value] of element.attributes) {
    // `on*` is dropped by omission from the allowlist, not by matching on the prefix. Stated
    // because it is the one people look for: there is no `startsWith('on')` check here and
    // there does not need to be — `onload` is not on any list above.
    if (!attributeIsAllowed(element.name, name)) continue;

    if (name === 'xmlns') {
      if (value !== SVG_NAMESPACE) continue;
    } else if (name === 'xmlns:xlink') {
      if (value !== XLINK_NAMESPACE) continue;
    } else if (REFERENCE_ATTRIBUTES.has(name)) {
      // A reference may only name something inside this very document. That is what rules
      // out `<use href="https://evil/x#y">` and every other off-origin fetch in one line.
      if (!LOCAL_FRAGMENT.test(value)) continue;
    } else if (!valueIsSafe(value)) {
      continue;
    }

    kept.push([name, value]);
  }

  return kept;
}

interface CleanElement {
  name: string;
  attributes: [string, string][];
  children: CleanNode[];
}

type CleanNode = CleanElement | { text: string };

function clean(node: ParsedNode, parentName: string): CleanNode | null {
  if (!isElement(node)) {
    return TEXT_BEARING_ELEMENTS.has(parentName) ? node : null;
  }

  // Deny by default, and drop the SUBTREE rather than unwrapping it. Unwrapping would keep
  // the HTML inside a `<foreignObject>` and the text inside a `<script>`.
  if (!ALLOWED_ELEMENTS.has(node.name)) return null;

  const children = node.children
    .map((child) => clean(child, node.name))
    .filter((child): child is CleanNode => child !== null);

  if (node.name === 'style') {
    const css = children.map((child) => ('text' in child ? child.text : '')).join('');
    if (!styleSheetIsSafe(css)) return null;
    return { name: 'style', attributes: cleanAttributes(node), children: [{ text: css }] };
  }

  const attributes = cleanAttributes(node);

  // A `<use>` whose reference was dropped for pointing off-origin draws nothing. Keeping the
  // husk would leave a confusing `<use/>` in the output that looks like something survived.
  if (node.name === 'use' && !attributes.some(([name]) => REFERENCE_ATTRIBUTES.has(name))) {
    return null;
  }

  return { name: node.name, attributes, children };
}

// -- Serialisation -----------------------------------------------------------

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Writes the output from the cleaned tree.
 *
 * Every `<`, `>`, `&` and `"` that survived as DATA is escaped here, so a text node or an
 * attribute value can never re-open as markup when the browser parses the result. This is
 * what makes the "parse, allowlist, re-serialise" claim true rather than aspirational.
 */
function serialise(node: CleanNode): string {
  if (!('name' in node)) return escapeText(node.text);

  const attributes = node.attributes
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');

  if (node.children.length === 0) return `<${node.name}${attributes}/>`;

  const inner = node.children.map(serialise).join('');
  return `<${node.name}${attributes}>${inner}</${node.name}>`;
}

// -- Entry point -------------------------------------------------------------

/**
 * Verifies the bytes really are an SVG and returns a sanitised copy.
 *
 * Throws `AppError.badRequest` when the input cannot be parsed as the accepted subset —
 * which is how a PNG renamed `.svg`, or any other file carrying a forged
 * `image/svg+xml` content type, is refused. Hostile CONTENT inside a genuine SVG is not an
 * error: it is silently dropped, and the caller gets back a clean icon.
 *
 * Sanitising happens here, once, before anything is written to disk. There is deliberately
 * no read-time equivalent: a file that reached storage is already clean, and a system that
 * cleans on the way out has hostile bytes sitting in it.
 */
export function sanitiseSvgIcon(input: Buffer): string {
  // A UTF-16 or UTF-32 BOM would parse as garbage; a UTF-8 one is common and harmless.
  let source = input.toString('utf8');
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  if (source.includes('\u0000')) refuse('хоёртын өгөгдөл');
  if (source.trim() === '') refuse('хоосон файл');

  const cleaned = clean(parse(source), '');
  // `clean` can only return null for the root if `<svg>` left the allowlist, which would be
  // a bug rather than an input problem; refusing is still the safe answer.
  if (cleaned === null || !('name' in cleaned)) refuse('агуулга хоосон');

  // Required for the browser to treat the file as SVG at all. Re-asserted rather than
  // trusted: a document whose xmlns was wrong had it dropped by `cleanAttributes` above.
  if (!cleaned.attributes.some(([name]) => name === 'xmlns')) {
    cleaned.attributes.unshift(['xmlns', SVG_NAMESPACE]);
  }

  return serialise(cleaned);
}
