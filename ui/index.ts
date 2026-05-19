/**
 * camsys/ui — React component subpath.
 *
 * Opt-in surface. Consumers that only use the CLI (`camsys run …`) or
 * the data face (`import { listEntries } from 'camsys'`) never load
 * this subpath, so they never resolve React.
 *
 * React + react-dom are declared as OPTIONAL peer dependencies; only
 * consumers that `import 'camsys/ui'` need them installed.
 */

export { ServicesPanel } from './ServicesPanel.js'
export type { ServicesPanelProps, ServicesIO, Entry } from './ServicesPanel.js'
