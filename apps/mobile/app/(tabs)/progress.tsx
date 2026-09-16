/**
 * Progress is a route-level alias of the existing Stats / History screen.
 * Keeping one implementation preserves every metric, heat map, and drill-down
 * while `/stats-history` remains available as a compatibility path.
 */
export { default } from './stats-history';
