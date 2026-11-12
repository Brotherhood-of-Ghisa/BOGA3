import type { MuscleReportRow } from '@/src/data/combined-muscles';
import {
  buildCombinedMuscleChecklist, buildCombinedMuscleSections, combinedMuscleEntryIds, buildMuscleListSections, canSaveCombinedMuscle,
  muscleChoiceLabel, muscleChoiceWrite, musclesOnStatus,
} from '@/src/preferences/muscle-setup-view';

const row = (id: string, family: string, sortOrder: number, reportGroup: string | null = null, tracked: number | boolean = 1): MuscleReportRow =>
  ({ id, displayName: id.toUpperCase(), familyName: family, sortOrder, reportGroup, tracked });
const definitions = [{ key: 'cm_arms', name: 'Arms', family: 'Arms' }, { key: 'cm_guns', name: 'Guns', family: 'Arms' }];
const rows = [
  row('biceps', 'Arms', 3, 'cm_arms'), row('triceps', 'Arms', 4, 'cm_arms', 0), row('forearms', 'Arms', 5, 'cm_guns', true),
  row('chest', 'Chest', 1), row('serratus', 'Chest', 2, null, false),
];

describe('the muscle setup as Settings shows it', () => {
  it('reads each muscle Off, On or its combined muscle, Off whatever it keeps', () => {
    expect(rows.map(candidate => muscleChoiceLabel(candidate, definitions))).toEqual(['Arms', 'Off', 'Guns', 'On', 'Off']);
    expect(musclesOnStatus(rows)).toBe('3 / 5 on');
  });

  it('lists families in sort order, a header above two or more', () => {
    expect(buildMuscleListSections({ rows: [...rows, row('neck', 'Neck', 9)], definitions }).map(section => [section.family, section.showHeader]))
      .toEqual([['Chest', true], ['Arms', true], ['Neck', false]]);
  });

  it('lists combined muscles by family with their On members; a family with no entries left sorts last', () => {
    const sections = buildCombinedMuscleSections({ rows, definitions: [...definitions, { key: 'cm_old', name: 'Old', family: 'Gone' }] });
    expect(sections.map(section => [section.family, section.muscles.map(muscle => `${muscle.name}: ${muscle.members}`)]))
      .toEqual([['Arms', ['Arms: BICEPS', 'Guns: FOREARMS']], ['Gone', ['Old: ']]]);
  });

  it.each([
    ['On to Off keeps the membership', rows[0], 'off', { kind: 'tracked', tracked: false }],
    ['Off back On rejoins the combined muscle', rows[1], 'own', { kind: 'tracked', tracked: true }],
    ['Off own muscle back On', rows[4], 'own', { kind: 'state', state: { kind: 'own' } }],
    ['a member On on its own', rows[0], 'own', { kind: 'state', state: { kind: 'own' } }],
    ['into another', rows[0], { key: 'cm_guns' }, { kind: 'state', state: { kind: 'combined', key: 'cm_guns' } }],
    ['the same choice', rows[0], { key: 'cm_arms' }, null],
    ['Off again', rows[1], 'off', null],
  ] as const)('writes %s', (_name, muscle, next, write) => {
    expect(muscleChoiceWrite(muscle, next)).toEqual(write);
  });

  it('ticks the editor checklist, noting Off muscles and another combined muscle an unticked one is in', () => {
    expect(buildCombinedMuscleChecklist({ rows, definitions }, 'Arms', new Set(['biceps', 'triceps']), 'cm_arms')).toEqual([
      { id: 'biceps', label: 'BICEPS', checked: true, note: null },
      { id: 'triceps', label: 'TRICEPS', checked: true, note: 'Off' },
      { id: 'forearms', label: 'FOREARMS', checked: false, note: 'in Guns' },
    ]);
    expect(buildCombinedMuscleChecklist({ rows, definitions }, 'Arms', new Set(), 'cm_guns')[1].note).toBe('Off, in Arms');
    expect(buildCombinedMuscleChecklist({ rows, definitions }, 'Arms', new Set(['forearms']), 'cm_arms')[2])
      .toMatchObject({ checked: true, note: null });
    expect(combinedMuscleEntryIds(rows, 'cm_arms')).toEqual(['biceps', 'triceps']);
  });

  it('saves with a name and a muscle', () => {
    expect(canSaveCombinedMuscle(' ', ['a'])).toBe(false);
    expect(canSaveCombinedMuscle('A', [])).toBe(false);
    expect(canSaveCombinedMuscle('A', ['a'])).toBe(true);
  });
});
