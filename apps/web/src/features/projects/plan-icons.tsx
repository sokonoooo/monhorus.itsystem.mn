import { OBJECT_ICON_LABELS, type ObjectIcon } from '@monhorus/shared';
import { useState, type ReactElement, type ReactNode } from 'react';

/**
 * The glyphs behind the section 4.1 icon keys.
 *
 * The registry stores a key and never a picture, deliberately, so this is where a key
 * becomes something to look at. It lives in the web app rather than in `packages/shared`
 * because it is JSX: the mobile clients cannot use an SVG element, and the one thing they
 * would share — the list of keys and their Mongolian names — is already in the shared
 * package as `OBJECT_ICONS` and `OBJECT_ICON_LABELS`.
 *
 * Every glyph is drawn on the same 24-unit grid with `currentColor` strokes, so a marker
 * takes its colour from the risk band around it and the drawing needs no palette of its
 * own. They are outlines rather than filled shapes because a plan marker is small and a
 * filled shape at 14px is a blob.
 */
const GLYPHS: Record<ObjectIcon, ReactNode> = {
  // A distribution cabinet: the enclosure with its rows of gear.
  PANEL: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 8.5h8M8 13h8" />
    </>
  ),
  // A breaker's lever, thrown off its contact.
  BREAKER: (
    <>
      <path d="M3 13h4M17 13h4" />
      <path d="M7 13l9-5" />
      <circle cx="17" cy="13" r="1" />
    </>
  ),
  // A lamp: bulb over its base.
  LIGHT: (
    <>
      <path d="M12 3a6 6 0 00-3.2 11.1V16h6.4v-1.9A6 6 0 0012 3z" />
      <path d="M9.5 19h5M10.5 21.5h3" />
    </>
  ),
  // A wall socket, seen face on.
  SOCKET: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 10v4M14.5 10v4" />
    </>
  ),
  // A toggle switch.
  SWITCH: (
    <>
      <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />
      <circle cx="8" cy="12" r="2.2" />
    </>
  ),
  // A run of cable.
  CABLE: (
    <>
      <path d="M3 17c4.5 0 4.5-10 9-10s4.5 6 9 6" />
      <path d="M3 17v3M21 13v3" />
    </>
  ),
  // A motor: the machine roundel with its M.
  MOTOR: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 15.5v-7l3.5 4 3.5-4v7" />
    </>
  ),
  // A pump: the casing with its impeller vane and discharge.
  PUMP: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M10 10.5l5.5 3-5.5 3z" />
      <path d="M12 6V2.5h5" />
    </>
  ),
  // A camera body with its lens barrel.
  CAMERA: (
    <>
      <rect x="2.5" y="7.5" width="12" height="9" rx="1.5" />
      <path d="M14.5 11l6.5-3.5v9L14.5 13z" />
    </>
  ),
  // A sensor: the element with what it picks up.
  SENSOR: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.6 7.6a6.2 6.2 0 000 8.8M16.4 7.6a6.2 6.2 0 010 8.8" />
    </>
  ),
  // A battery with the supply it holds up.
  UPS: (
    <>
      <rect x="2.5" y="6.5" width="16" height="11" rx="1.5" />
      <path d="M21.5 10v4" />
      <path d="M12 8.5l-2.5 4H12l-1 3" />
    </>
  ),
  // A rack of stacked units.
  SERVER_RACK: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M4 9h16M4 15h16" />
      <path d="M7 6h.01M7 12h.01M7 18h.01" />
    </>
  ),
  // Moving air.
  HVAC: (
    <>
      <path d="M3 7.5h11a3 3 0 10-3-3" />
      <path d="M3 12h14.5a3 3 0 113 3" />
      <path d="M3 16.5h8a2.6 2.6 0 100 5" />
    </>
  ),
  // Anything the catalogue has no shape for: a plain marked spot.
  OTHER: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
};

interface ObjectTypeIconProps {
  /** Null for an object whose type was removed from the registry. */
  icon: ObjectIcon | null;
  className?: string;
}

/**
 * The icon for a type key.
 *
 * Hidden from assistive technology on purpose: everywhere it is used the thing it sits
 * inside already carries the object's code and name, and a second reading of "Автомат
 * таслуур" after them adds nothing. `OBJECT_ICON_LABELS` is exported alongside for the
 * places that do want the words.
 */
export function ObjectTypeIcon({ icon, className = 'h-3.5 w-3.5' }: ObjectTypeIconProps): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[icon ?? 'OTHER']}
    </svg>
  );
}

interface ObjectTypeGlyphProps {
  /** The built-in key, and the fallback whenever there is no custom icon to draw. */
  icon: ObjectIcon | null;
  /**
   * A ready-to-render url for the type's uploaded SVG, or null.
   *
   * Already resolved by the caller: `GET /files/:id` wants the bearer token, so what
   * arrives here is the object url of an icon that has been fetched, never the raw
   * `/api/v1/files/...` path from the DTO.
   */
  iconUrl: string | null;
  className?: string;
}

/**
 * A type's icon: the uploaded one where there is one, the built-in glyph otherwise.
 *
 * The custom icon is drawn with `<img>`, and that is a security decision rather than a
 * convenience. An SVG is a document — inlined into this page, whether through React's
 * raw-HTML escape hatch or as an `<svg>` rebuilt from fetched markup, its script and its
 * event handlers would run with the application's own origin and its session, and the
 * absence of that escape hatch in this file is pinned by a test. Inside an `<img>` it
 * cannot run at all: the browser treats it as a picture, scripts never execute, and
 * external references are not followed.
 *
 * The server sanitises what it stores and serves it under a locked-down CSP;
 * this is the second layer, and it is what has to hold if the first one is ever wrong.
 *
 * A broken url falls back to the glyph rather than leaving the browser's broken-image box
 * in the middle of a plan marker. The failure is remembered per url, so a different icon
 * arriving later is given its own chance, and setting the same url twice is a no-op React
 * bails out of — a marker on the canvas re-renders on every pan.
 */
export function ObjectTypeGlyph({
  icon,
  iconUrl,
  className = 'h-3.5 w-3.5',
}: ObjectTypeGlyphProps): ReactElement {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  if (!iconUrl || brokenUrl === iconUrl) {
    return <ObjectTypeIcon icon={icon} className={className} />;
  }

  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      // `object-contain` because an uploaded icon is whatever shape it was drawn at, and
      // a marker is a fixed square: the icon fits inside it rather than stretching to it.
      className={`${className} object-contain`}
      onError={() => setBrokenUrl(iconUrl)}
    />
  );
}

/** The catalogue's own name for a key, for a tooltip or a legend. */
export function objectIconLabel(icon: ObjectIcon | null): string {
  return OBJECT_ICON_LABELS[icon ?? 'OTHER'];
}
