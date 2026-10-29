import { familySections } from '@/components/stats/history-title';

describe('familySections', () => {
  it('heads only families of two or more muscles, headerless ones first, then the fixed family order with Other last', () => {
    const sections = familySections([
      { id: 'other', displayName: 'Grip', familyName: 'Other' },
      { id: 'triceps', displayName: 'Triceps', familyName: 'Arms' },
      { id: 'pecs', displayName: 'Pectoralis', familyName: 'Chest' },
      { id: 'serratus', displayName: 'Serratus', familyName: 'Chest' },
      { id: 'biceps', displayName: 'Biceps', familyName: 'Arms' },
      { id: 'calves', displayName: 'Calves', familyName: 'Calves' },
    ]);
    expect(sections.map(({ familyName, header, members }) => [familyName, header, members.map(muscle => muscle.id)])).toEqual([
      ['Calves', false, ['calves']],
      ['Chest', true, ['pecs', 'serratus']],
      ['Arms', true, ['triceps', 'biceps']],
      ['Other', true, ['other']],
    ]);
  });
});
