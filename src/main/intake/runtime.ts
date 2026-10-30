/** Standalone packaged entry for worker use and verification; UI wiring follows in M7. */
export { buildClosure, type ClosureOptions } from './closure'
export { ExpandCache } from './expandCache'
export { intakeBudget } from '../../shared/constants'
export { computeCoverage, planSelection, type ClosureSource, type SelectionResult } from './match'
