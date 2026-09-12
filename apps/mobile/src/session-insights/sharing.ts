import { Share } from 'react-native';

import type { ExercisePersonalRecord } from './calculations';

type ShareText = (content: { message: string }) => Promise<unknown>;

const formatLoad = (value: number): string =>
  Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;

export const buildPersonalRecordShareMessage = (
  personalRecord: ExercisePersonalRecord
): string =>
  `New PR: ${personalRecord.exerciseName} — ${formatLoad(personalRecord.weight)} kg × ${
    personalRecord.reps
  } reps · estimated 1RM ${Math.round(personalRecord.estimatedOneRepMax)} kg.`;

export const sharePersonalRecord = async (
  personalRecord: ExercisePersonalRecord,
  shareText: ShareText = Share.share
): Promise<void> => {
  await shareText({ message: buildPersonalRecordShareMessage(personalRecord) });
};
