import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  validateBogaSessionImportPackage,
  type BogaImportCatalog,
} from '@/scripts/import/boga-import-contract';
import {
  digestGymBookExport,
  parseGymBookXml,
  readGymBookXmlBuffer,
} from '@/scripts/import/gymbook-digester';

const fixturePath = join(__dirname, 'fixtures', 'gymbook-synthetic.xml');

const catalog: BogaImportCatalog = {
  exercises: [
    {
      id: 'exercise-bench',
      name: 'Bench Press',
    },
  ],
  gyms: [
    {
      id: 'gym-lunch',
      name: 'Lunch Gym',
    },
    {
      id: 'gym-evening',
      name: 'Evening Gym',
    },
  ],
};

const baseOptions = {
  importingProfileLabel: 'Synthetic User',
  catalog,
  sourceFile: {
    path: fixturePath,
    sizeBytes: 123,
    sha256: 'synthetic-hash',
  },
  gymAssignments: {
    midday: 'gym-lunch',
    weekdayEvening: 'gym-evening',
    weekend: null,
  },
};

describe('GymBook digester', () => {
  it('decodes UTF-16LE GymBook exports and parses rows including self-closing tags', () => {
    const utf16Buffer = Buffer.from(`\ufeff${readFileSync(fixturePath, 'utf8')}`, 'utf16le');

    const xml = readGymBookXmlBuffer(utf16Buffer);
    const parsed = parseGymBookXml(xml);

    expect(parsed).toHaveLength(6);
    expect(parsed[0]).toMatchObject({
      date: '05/01/2026',
      workout: 'Upper',
      time: '12:10',
      exercise: 'Bench Press',
      notes: '',
      skipped: 'No',
    });
    expect(parsed[1].notes).toBe('Synthetic note to preserve');
  });

  it('skips GymBook skipped rows and reports preserved source notes', () => {
    const pkg = digestGymBookExport(readFileSync(fixturePath, 'utf8'), {
      ...baseOptions,
      allowUnresolvedExercises: true,
    });

    expect(pkg.report.counts.sourceRows).toBe(6);
    expect(pkg.report.counts.skippedRows).toBe(1);
    expect(pkg.report.notes).toEqual([
      expect.objectContaining({
        sourceExerciseName: 'Bench Press',
        note: 'Synthetic note to preserve',
      }),
    ]);
    expect(
      pkg.sessions.flatMap((session) =>
        session.exercises.flatMap((exercise) => exercise.sets)
      )
    ).toHaveLength(4);
  });

  it('extends raw spans under 30 minutes to 60 minutes and warns', () => {
    const pkg = digestGymBookExport(readFileSync(fixturePath, 'utf8'), {
      ...baseOptions,
      allowUnresolvedExercises: true,
    });

    const shortSession = pkg.sessions.find((session) => session.localDate === '2026-01-05');

    expect(shortSession?.rawSpanSec).toBe(120);
    expect(shortSession?.durationSec).toBe(3600);
    expect(shortSession?.warnings).toEqual([
      expect.objectContaining({
        code: 'duration_inferred_short_span',
      }),
    ]);
  });

  it('warns when a raw session span exceeds 90 minutes', () => {
    const pkg = digestGymBookExport(readFileSync(fixturePath, 'utf8'), {
      ...baseOptions,
      allowUnresolvedExercises: true,
      sessionClusterGapMinutes: 120,
    });

    const longSession = pkg.sessions.find((session) => session.localDate === '2026-01-07');

    expect(longSession?.rawSpanSec).toBe(5700);
    expect(longSession?.warnings).toEqual([
      expect.objectContaining({
        code: 'duration_raw_span_over_90_min',
      }),
    ]);
  });

  it('rejects unresolved exercise mappings unless review draft mode allows them', () => {
    expect(() =>
      digestGymBookExport(readFileSync(fixturePath, 'utf8'), baseOptions)
    ).toThrow('Unresolved GymBook exercise mappings');

    const pkg = digestGymBookExport(readFileSync(fixturePath, 'utf8'), {
      ...baseOptions,
      allowUnresolvedExercises: true,
    });

    expect(pkg.report.unresolvedExercises).toEqual([
      expect.objectContaining({
        sourceExerciseName: 'Mystery Squat',
      }),
    ]);
  });

  it('validates the source-neutral BOGA session import contract', () => {
    const pkg = digestGymBookExport(readFileSync(fixturePath, 'utf8'), {
      ...baseOptions,
      exerciseDecisions: {
        'Mystery Squat': {
          decision: 'create_new',
          exerciseName: 'Mystery Squat',
          muscleMappings: [],
        },
      },
    });

    expect(validateBogaSessionImportPackage(pkg)).toEqual({ ok: true, errors: [] });
    expect(validateBogaSessionImportPackage({ ...pkg, schema: 'wrong' })).toEqual({
      ok: false,
      errors: ['schema must be boga.session-import.v1'],
    });
  });
});
