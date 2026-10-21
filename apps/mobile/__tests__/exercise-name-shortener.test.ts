import { shortenExerciseName } from '@/src/exercise-catalog/shorten-exercise-name';

const mappings = [
  ['One Hand', '1H'],
  ['Single Hand', '1H'],
  ['One Arm', '1A'],
  ['Single Arm', '1A'],
  ['One Leg', '1L'],
  ['Single Leg', '1L'],
  ['Kettlebell', 'KB'],
  ['Kettlebells', 'KBs'],
  ['Dumbbell', 'DB'],
  ['Dumbbells', 'DBs'],
  ['Barbell', 'BRB'],
  ['Smith Machine', 'S/M'],
  ['Cable Machine', 'C/M'],
  ['Cable', 'C/M'],
  ['Overhead', 'O/H'],
  ['Supported', 'Supp.'],
  ['Alternating', 'Alt.'],
  ['Extension', 'Ext.'],
  ['Extensions', 'Ext.'],
  ['Rotation', 'Rot.'],
  ['Rotations', 'Rot.'],
  ['Close Grip', 'CG'],
  ['Wide Grip', 'WG'],
  ['Romanian Deadlift', 'RDL'],
  ['Romanian Deadlifts', 'RDLs'],
  ['Deadlift', 'DL'],
  ['Deadlifts', 'DLs'],
  ['Assisted', 'Asst.'],
];

describe('shortenExerciseName', () => {
  it.each(mappings)('shortens %s to %s in any letter case', (name, expected) => {
    expect(shortenExerciseName(name)).toBe(expected);
    expect(shortenExerciseName(name.toLowerCase())).toBe(expected);
    expect(shortenExerciseName(name.toUpperCase())).toBe(expected);
  });

  it.each([
    ['Barbell Deadlifts', 'BRB DLs'],
    ['Dumbbell Romanian Deadlifts', 'DB RDLs'],
    ['Single Leg Romanian Deadlifts', '1L RDLs'],
    ['Supported Dumbbell Reverse Fly', 'Supp. DB Reverse Fly'],
    ['Alternating Incline Dumbbell Twist Curls', 'Alt. Incline DB Twist Curls'],
    ['Standing High Cable One-Arm Triceps Extensions', 'Standing High C/M 1A Triceps Ext.'],
    ['sInGlE-hAnD Dumbbell OVERHEAD Press', '1H DB O/H Press'],
    ['Smith-Machine Cable-Machine Romanian-Deadlift', 'S/M C/M RDL'],
    ['Cable Machine Cable Smith Machine Machine Deadlifts Romanian Deadlifts', 'C/M C/M S/M Machine DLs RDLs'],
  ])('combines replacements in %s', (name, expected) => {
    expect(shortenExerciseName(name)).toBe(expected);
  });

  it('replaces every occurrence without consuming shared separators', () => {
    expect(shortenExerciseName('Dumbbell,Dumbbell Dumbbell/Dumbbell')).toBe('DB,DB DB/DB');
    expect(shortenExerciseName('Cable Machine/Cable-Machine')).toBe('C/M/C/M');
  });

  it('preserves surrounding case, whitespace and punctuation exactly', () => {
    expect(shortenExerciseName('  (Dumbbell)\tPress,\nSingle  - Hand + Cable!  ')).toBe(
      '  (DB)\tPress,\n1H + C/M!  '
    );
    expect(shortenExerciseName('Supported. Assisted!')).toBe('Supp.. Asst.!');
  });

  it.each([
    '',
    ' \t\n ',
    'Standing Incline Lateral Hammer Triceps',
    'Machine',
    'Seated Machine Row',
    'Cableless Dumbbellish Unassisted Unsupported Deadlifting',
    'OneHand SingleArm SingleLeg CloseGrip WideGrip',
    'Barbells',
    'Dumbbell2 2Dumbbell Dumbbell_name name_Dumbbell',
    'éDumbbell Dumbbellé приветDumbbell Dumbbell東京',
    'Dumbbell\u0301 \u0301Dumbbell',
    '1H 1A 1L KB KBs DB DBs BRB S/M C/M O/H Supp. Alt. Ext. Rot. CG WG RDL RDLs DL DLs Asst.',
  ])('leaves unsupported text and existing abbreviations unchanged: %p', (name) => {
    expect(shortenExerciseName(name)).toBe(name);
  });

  it('preserves non-English text around separated supported words', () => {
    expect(shortenExerciseName('東京 (Dumbbell) — élevation 💪 Cable')).toBe(
      '東京 (DB) — élevation 💪 C/M'
    );
  });

  it.each(mappings)('is idempotent for %s', (name) => {
    const shortened = shortenExerciseName(name);
    expect(shortenExerciseName(shortened)).toBe(shortened);
  });
});
