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
 * It also checks the real exported partition has the expected five-layer shape
 * so a structural regression in the single source is caught here too.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { TOPO_LAYERS } from '@/src/sync/topo-order';

const SYNC_DIR = join(__dirname, '..', '..', 'src', 'sync');
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
  it('declares five layers spanning sixteen entity types', () => {
    expect(TOPO_LAYERS).toHaveLength(5);
    const flat = TOPO_LAYERS.flat();
    expect(new Set(flat).size).toBe(16);
    // Layer 0 anchors the FK graph (no outbound entity FKs); M23 adds the
    // programme container.
    expect([...TOPO_LAYERS[0]].sort()).toEqual([
      'exercise_definitions',
      'gyms',
      'muscle_groups',
      'training_programmes',
      'user_settings',
    ]);
    // exercise_group_links sits in Layer 1, after its exercise_definitions parent;
    // M23 adds session_plans (FKs gyms + training_programmes, both Layer 0).
    expect(TOPO_LAYERS[1]).toContain('exercise_group_links');
    expect(TOPO_LAYERS[1]).toContain('session_plans');
    // sessions moved L1->L2 to sit below session_plans; the block joins it.
    expect(TOPO_LAYERS[2]).toEqual(['sessions', 'session_plan_exercises']);
    // session_exercises moved L2->L3 to sit below session_plan_exercises.
    expect(TOPO_LAYERS[3]).toEqual(['session_exercises', 'session_plan_sets']);
    // exercise_sets moved L3->L4 to sit below session_plan_sets, alongside the
    // tags join and the independently cursorable bodyweight root.
    expect(TOPO_LAYERS[4]).toEqual([
      'exercise_sets',
      'session_exercise_tags',
      'body_weight_measurements',
    ]);
  });
});
