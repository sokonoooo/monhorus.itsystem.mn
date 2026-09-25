import type { HelpRegistry } from './help-content.types';

import { accessHelp } from './content/access';
import { assetsHelp } from './content/assets';
import { directoryHelp } from './content/directory';
import { operationsHelp } from './content/operations';
import { plannedWorkHelp } from './content/planned-work';
import { portalHelp } from './content/portal';

export type { HelpField, HelpLink, HelpRegistry, PageHelp } from './help-content.types';
export { resolveHelp } from './resolve-help';

/**
 * Every page's help, in one place.
 *
 * Split into files by feature area purely so each stays readable; the merge is flat, and a
 * route belongs to exactly one of them. Listing a route in two files silently lets the last
 * import win, so keep each route in the file that owns its feature.
 */
export const HELP_CONTENT: HelpRegistry = {
  ...accessHelp,
  ...assetsHelp,
  ...directoryHelp,
  ...operationsHelp,
  ...plannedWorkHelp,
  ...portalHelp,
};
