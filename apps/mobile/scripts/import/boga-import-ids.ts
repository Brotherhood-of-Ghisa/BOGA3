import { createHash } from 'node:crypto';

import type { BogaImportExerciseDecision, BogaImportSession, BogaImportSessionExercise, BogaImportSet, BogaSessionImportPackage } from './boga-import-contract';

const hashId = (prefix: string, ...parts: string[]) =>
  `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`;

export const generatedSessionId = (pkg: BogaSessionImportPackage, session: BogaImportSession) =>
  hashId(
    'import-session',
    pkg.schema,
    pkg.source.app,
    pkg.source.exportFile.sha256 ?? pkg.source.exportFile.path ?? 'source',
    session.importSessionKey
  );

export const generatedSessionExerciseId = (sessionId: string, exercise: BogaImportSessionExercise) =>
  hashId('import-session-exercise', sessionId, String(exercise.orderIndex));

export const generatedSetId = (sessionExerciseId: string, set: BogaImportSet) =>
  hashId('import-set', sessionExerciseId, String(set.orderIndex), String(set.source.rowIndex));

export const generatedExerciseDefinitionId = (pkg: BogaSessionImportPackage, decision: BogaImportExerciseDecision) => {
  if (decision.decision !== 'create_new') {
    throw new Error('Internal error: cannot generate an exercise id for a map_existing decision');
  }
  return hashId('import-exercise-definition', pkg.schema, pkg.source.app, decision.importExerciseKey);
};

export const generatedExerciseMuscleMappingId = (exerciseDefinitionId: string, muscleGroupId: string) =>
  hashId('import-exercise-muscle', exerciseDefinitionId, muscleGroupId);
