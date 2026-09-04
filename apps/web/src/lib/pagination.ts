/**
 * The page size every paged list in the admin console uses.
 *
 * ONE VALUE, NOT THIRTEEN. Thirteen screens each declared their own `const PAGE_SIZE = 20`
 * with the same value and the same stated intent, so "show more rows per page" was a
 * thirteen-file change that nobody would make consistently — and a table whose pager was
 * built from one constant while its request carried another would silently mis-number its
 * rows.
 *
 * A screen with a genuinely different reason for its size still states it locally, next to
 * that reason: `ReportsPage` asks for 25 because the endpoint's own default of a thousand
 * belongs to its CSV export, and `OpenServiceRequestsPage` asks for 100 because it fetches
 * one page per status and 100 is the server's cap. Neither is this constant in disguise,
 * so neither is routed through it.
 */
export const PAGE_SIZE = 20;
