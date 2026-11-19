export const RECORDING_MODES = ['reps', 'hold'] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export const isRecordingMode = (value: unknown): value is RecordingMode =>
  value === 'reps' || value === 'hold';
