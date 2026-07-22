import {
  DEFAULT_TWO_SIDED_TOTAL_WEIGHT_EXERCISES,
  digestGymBookExport,
} from '../../scripts/import/gymbook-digester';

const gymAssignments = {
  midday: null,
  weekdayEvening: null,
  weekend: null,
};

const catalog = {
  exercises: [
    { id: 'seed_arnold_presses', name: 'Arnold Presses' },
    { id: 'seed_one_arm_arnold_presses', name: 'One-Arm Arnold Presses' },
  ],
  gyms: [],
};

const logRow = (exercise: string, weight: string, time: string) => `<log>
  <date>01/07/2026</date>
  <workout>Shoulders</workout>
  <time>${time}</time>
  <exercise>${exercise}</exercise>
  <targetRegion>Shoulders</targetRegion>
  <targetMusclesPrimary>Shoulders</targetMusclesPrimary>
  <targetMusclesSecondary>Arm extensors</targetMusclesSecondary>
  <type>default</type>
  <reps>10</reps>
  <weight>${weight}</weight>
  <notes/>
  <skipped>No</skipped>
</log>`;

describe('GymBook import digester', () => {
  it('halves default two-sided Arnold Presses but leaves one-arm Arnold Presses as logged', () => {
    const pkg = digestGymBookExport(
      `<logs>
        ${logRow('Arnold Presses', '25.00 kg', '12:00')}
        ${logRow('One-Arm Arnold Presses', '12.00 kg', '12:05')}
      </logs>`,
      {
        importingProfileLabel: 'test',
        catalog,
        generatedAt: new Date('2026-07-01T12:10:00.000Z'),
        timezone: 'Europe/London',
        gymAssignments,
      }
    );

    const arnold = pkg.sessions[0].exercises.find((exercise) => exercise.sourceExerciseName === 'Arnold Presses');
    const oneArm = pkg.sessions[0].exercises.find(
      (exercise) => exercise.sourceExerciseName === 'One-Arm Arnold Presses'
    );

    expect(DEFAULT_TWO_SIDED_TOTAL_WEIGHT_EXERCISES).toContain('Arnold Presses');
    expect(pkg.options.halveWeightExercises).toContain('Arnold Presses');
    expect(arnold?.sets[0]).toMatchObject({
      weightValue: '12.5',
      source: {
        weightLoggedKg: '25',
        weightAdjustment: 'two_sided_halved',
      },
    });
    expect(oneArm?.sets[0].weightValue).toBe('12');
    expect(oneArm?.sets[0].source.weightAdjustment).toBeUndefined();
    expect(pkg.report.counts.weightsHalvedSets).toBe(1);
    expect(pkg.report.weightHalvedExercises).toEqual([{ sourceExerciseName: 'Arnold Presses', setCount: 1 }]);
  });
});
