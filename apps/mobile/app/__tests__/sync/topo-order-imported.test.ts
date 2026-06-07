/**
 * Outcome: the FK layering has a single source of truth.
 *
 * The topological layer partition (which entity types live in which FK layer)
 * is declared once in `src/sync/topo-order.ts` and the schema-drift checker
 * keeps it in lock-step with the live FK graph. The cycle and scheduler must
 * IMPORT that partition, never re-declare it — a copied layer array would drift
 * silently the next time the FK graph changes.
 *
 * This file reads the cycle and scheduler source and asserts:
 *
 *   1. `TOPO_LAYERS` appears only as the canonical import / consumption, never
 *      as a fresh `export const TOPO_LAYERS = [...]` re-declaration.
 *   2. No inline layer-array literal (e.g. a hardcoded `['gyms', ...]` block)
 *      duplicates the partition.
 *
 * It also checks the real exported partition has the expected four-layer shape
 * so a structural regression in the single source is caught here too.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { TOPO_LAYERS } from '@/src/sync/topo-order';

const SYNC_DIR = join(__dirname, '..', '..', '..', 'src', 'sync');
const CYCLE_PATH = join(SYNC_DIR, 'cycle.ts');
const SCHEDULER_PATH = join(SYNC_DIR, 'scheduler.ts');

describe('the cycle and scheduler import the layer partition, never redefine it', () => {
  const consumers: [string, string][] = [
    ['cycle.ts', CYCLE_PATH],
    ['scheduler.ts', SCHEDULER_PATH],
  ];

  it.each(consumers)('%s does not re-declare TOPO_LAYERS', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    // A re-declaration would assign to the name; only the import/consumption is
    // allowed.
    expect(/(?:export\s+)?const\s+TOPO_LAYERS\s*=/.test(source)).toBe(false);
    expect(/(?:let|var)\s+TOPO_LAYERS\s*=/.test(source)).toBe(false);
  });

  it('cycle.ts imports TOPO_LAYERS from the canonical module', () => {
    const source = readFileSync(CYCLE_PATH, 'utf8');
    // The canonical consumption: an import that names TOPO_LAYERS from
    // the topo-order module.
    const importsCanonically =
      /import\s*\{[^}]*\bTOPO_LAYERS\b[^}]*\}\s*from\s*['"][^'"]*topo-order['"]/.test(source);
    expect(importsCanonically).toBe(true);
  });

  it.each(consumers)('%s contains no inline four-layer array literal', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    // A duplicated partition would inline the Layer-0 entity pair as an array
    // literal. The canonical module is the only place that literal may live.
    const hasInlineLayerLiteral = /\[\s*['"]gyms['"]\s*,\s*['"]exercise_definitions['"]/.test(
      source,
    );
    expect(hasInlineLayerLiteral).toBe(false);
  });
});

describe('the single source of truth has the expected shape', () => {
  it('declares exactly four layers spanning the nine entity types', () => {
    expect(TOPO_LAYERS).toHaveLength(4);
    const flat = TOPO_LAYERS.flat();
    expect(new Set(flat).size).toBe(9);
    // Layer 0 anchors the FK graph (no outbound entity FKs).
    expect([...TOPO_LAYERS[0]].sort()).toEqual([
      'exercise_definitions',
      'gyms',
      'muscle_groups',
    ]);
  });
});
