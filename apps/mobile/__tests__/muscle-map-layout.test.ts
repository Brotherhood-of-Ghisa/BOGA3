import { muscleMapLayout, MUSCLE_MAP_FAMILY_VOLUMES, MUSCLE_MAP_HEADER, MUSCLE_MAP_INSET } from '@/components/stats/muscle-map-layout';
import { MUSCLE_MAP_REFERENCE } from '@/components/stats/muscle-map-reference';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { uiGeometry } from '@/components/ui';

it('maps the complete taxonomy once, with non-overlapping source-model family totals', () => {
  expect(MUSCLE_MAP_REFERENCE.map(row => row.id).sort()).toEqual(SYSTEM_MUSCLE_GROUP_SEEDS.map(row => row.id).sort());
  expect(new Set(MUSCLE_MAP_REFERENCE.map(row => row.id)).size).toBe(25);
  const expected = { Legs: 5124.06, Back: 1133.41, Chest: 488.1, Shoulders: 729.39, Arms: 1200.2, Core: 415.32, 'Lower Legs': 899.5 };
  for (const [family, volume] of Object.entries(expected)) {
    expect(MUSCLE_MAP_FAMILY_VOLUMES[family as keyof typeof expected]).toBeCloseTo(volume, 9);
  }
});

it.each([260, 288, 343, 358, 398])('preserves exact family shares, child bounds and accessible targets at width %i', width => {
  const layout = muscleMapLayout(width);
  const area = width * layout.height;
  const total = Object.values(MUSCLE_MAP_FAMILY_VOLUMES).reduce((a, b) => a + b, 0);
  expect(Object.values(layout.families).reduce((sum, r) => sum + r.width * r.height, 0)).toBeCloseTo(area, 7);
  for (const family of Object.keys(layout.families) as (keyof typeof layout.families)[]) {
    const box = layout.families[family];
    expect(box.width * box.height / area).toBeCloseTo(MUSCLE_MAP_FAMILY_VOLUMES[family] / total, 12);
    const children = MUSCLE_MAP_REFERENCE.filter(row => row.family === family).map(row => layout.muscles[row.id]);
    expect(children.reduce((sum, r) => sum + r.width * r.height, 0)).toBeCloseTo((box.width - MUSCLE_MAP_INSET * 2) * (box.height - MUSCLE_MAP_HEADER - MUSCLE_MAP_INSET), 7);
    for (const child of children) {
      expect(child.x).toBeGreaterThanOrEqual(box.x);
      expect(child.y).toBeGreaterThanOrEqual(box.y + MUSCLE_MAP_HEADER);
      expect(child.x + child.width).toBeLessThanOrEqual(box.x + box.width + 1e-8);
      expect(child.y + child.height).toBeLessThanOrEqual(box.y + box.height + 1e-8);
      expect(child.width).toBeGreaterThanOrEqual(uiGeometry.tapTarget - 1e-8);
      expect(child.height).toBeGreaterThanOrEqual(uiGeometry.tapTarget);
    }
  }
  const boxes = Object.values(layout.muscles);
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
    const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    expect(x <= 1e-8 || y <= 1e-8).toBe(true);
  }));
  expect(muscleMapLayout(width)).toEqual(layout);
});
