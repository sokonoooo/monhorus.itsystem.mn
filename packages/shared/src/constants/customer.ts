/**
 * Ceiling for a customer's letterhead, in bytes.
 *
 * The same 2MB the company logo carries, and for the same reason: this is a masthead
 * drawn at about 10mm tall on a page, so anything larger is bytes nobody can see. Both
 * the upload form and the route that accepts the file check against this — the form as a
 * courtesy that saves a round trip, the route as the one that decides.
 */
export const MAX_CUSTOMER_LOGO_BYTES = 2 * 1024 * 1024;

/** What the customer logo endpoint accepts. Raster only: a PDF cannot draw an SVG. */
export const CUSTOMER_LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;
