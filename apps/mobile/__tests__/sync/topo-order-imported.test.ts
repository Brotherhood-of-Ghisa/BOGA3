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
 * It also checks the real exported partition has the expected six-layer shape
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
  it('declares six layers spanning nineteen entity types', () => {
    expect(TOPO_LAYERS).toHaveLength(6);
    const flat = TOPO_LAYERS.flat();
    expect(new Set(flat).size).toBe(19);
    // Layer 0 anchors the FK graph (no outbound entity FKs);  adds the
    // programme container.
    expect([...TOPO_LAYERS[0]].sort()).toEqual([
      'exercise_definitions',
      'gyms',
      'muscle_groups',
      'training_programmes',
      'user_settings',
    ]);
    // exercise_group_links sits in Layer 1, after its exercise_definitions parent;
    //  adds session_plans (FKs gyms + training_programmes, both Layer 0).
    expect(TOPO_LAYERS[1]).toContain('exercise_group_links');
    expect(TOPO_LAYERS[1]).toContain('session_plans');
    // Training notes FK only exercise_definitions (Layer 0).
    expect(TOPO_LAYERS[1]).toContain('training_notes');
    // Injuries FK only muscle_groups (Layer 0).
    expect(TOPO_LAYERS[1]).toContain('injuries');
    // Uses follow plans, before the performed graph.
    expect(TOPO_LAYERS[2]).toEqual(['session_plan_exercises', 'session_plan_uses']);
    // Sessions follow use identities; authored targets follow blocks.
    expect(TOPO_LAYERS[3]).toEqual(['sessions', 'session_plan_sets']);
    // Performed cards follow sessions, and sets follow cards, alongside the
    // tags join and the independently cursorable bodyweight root.
    expect(TOPO_LAYERS[4]).toEqual(['session_exercises']);
    expect(TOPO_LAYERS[5]).toEqual([
      'exercise_sets',
      'session_exercise_tags',
      'body_weight_measurements',
    ]);
  });
});
