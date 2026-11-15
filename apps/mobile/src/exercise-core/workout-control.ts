import type { MergeWireEntity } from './merge-types';

export class WorkoutAiControlled extends Error {
  constructor() {
    super('AI is logging this session. Take over logging in Session options to edit.');
    this.name = 'WorkoutAiControlled';
  }
}

export function workoutLoggingClientId(baseline?: readonly MergeWireEntity[]): string | null {
  const header = baseline?.find(row => row.type === 'sessions');
  return typeof header?.fields.logging_client_id === 'string'
    ? header.fields.logging_client_id : null;
}

export function assertHumanWorkoutControl(row?: { status: string; loggingClientId?: string | null } | null): void {
  if (row?.loggingClientId) throw new WorkoutAiControlled();
}
