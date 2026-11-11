import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BogaAgentApi } from './api-client.js';
import { invoke, tokenFrom } from './tool-call.js';
import { hasOneWorkoutExerciseReference, isWorkoutOperationKey, isWorkoutWeight } from './workout-input.js';

const id = z.string().min(1).max(200).refine(value => value.trim().length > 0);
const revision = z.string().regex(/^[a-f0-9]{32}$/);
const operationKey = z.string().refine(isWorkoutOperationKey, 'Use 1–128 printable ASCII characters without whitespace.');
const performance = z.object({
  weight_kg: z.string().refine(isWorkoutWeight, 'Use non-negative decimal text in kg, without exponent notation.'),
  reps: z.number().int().min(1).max(999),
  set_type: z.enum(['warm_up', 'technique', 'cooldown', 'rir_0', 'rir_1', 'rir_2', 'rir_3', 'rir_4']).nullable().optional(),
}).strict();
const writeShape = { session_id: id, expected_revision: revision, idempotency_key: operationKey };
const additive = { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false } as const;
const replacing = { ...additive, destructiveHint: true } as const;
const readOnly = { ...additive, readOnlyHint: true } as const;

const WRITE_RULES = ' Requires the separate workout logging switch in Connected Agents AND control of this session. start_workout and create_workout give this client control immediately. Inspect control.can_edit before editing. If false on an active workout, the person must choose Let AI log this session in BoGa and select this client. Released or taken-over completed history can only be edited in BoGa; MCP cannot reclaim it. WORKOUT_CONTROL_REQUIRED means control was taken over or belongs elsewhere: stop writes, read current control and never reclaim automatically. Active ad-hoc workouts and completed workouts still controlled by this client are writable; requires_app means continue in BoGa. Use IDs and the current expected_revision from a read/write. A lost-response retry repeats the exact payload and idempotency_key; a new intentional set, even identical, needs a fresh key and current revision. On REVISION_CONFLICT read again and confirm the intended change; never silently replay it with a new revision. Outputs are synced server state, not unsynced phone data.';
const PERFORMANCE_RULES = ' Enter performed values only, never plan targets. weight_kg is explicit decimal kg ("0" for no external load), retaining the exercise’s total/per-side input meaning; resolve exercise identity and units with search_exercises/profile before logging, never guess from a name. set_type is null when unspecified, warm_up/technique/cooldown or rir_0..rir_4 when stated. Do not infer effort or turn a target into performance.';

export function registerWorkoutTools(server: McpServer, api: BogaAgentApi): void {
  server.registerTool('get_active_workout', {
    annotations: readOnly,
    title: 'Get active workout',
    description: 'Discover all synced active workout headers, or select session_id to read its persisted lifecycle, exercise blocks and sets with stable IDs and raw values. Requires workout logging permission even though read-only. Each header reports control.owner (human or mcp), control.client_id and control.can_edit for this client. This reports human takeover on the next call; if can_edit is false, stop writes. The person can hand an active workout to this client in BoGa; released or taken-over completed history must be edited in BoGa. Choose explicitly if several are active; never merge or assume the latest. A selected ID also reads dated completed workouts, with current control, finished/deleted state and requires_app. Keep the session_id returned by create_workout to resume entry; dated workouts are absent from active discovery. Drain next_cursor using the same session_id and revision; REVISION_CONFLICT requires a fresh read. This is server-synced state only, not the phone’s unsynced workout.',
    inputSchema: z.object({ session_id: id.optional(), cursor: z.string().min(1).max(202).optional(),
      limit: z.number().int().min(1).max(100).optional(), revision: revision.optional() }).strict(),
  }, async (input, extra) => invoke(() => api.getActiveWorkout(tokenFrom(extra), input)));

  server.registerTool('create_workout', {
    annotations: additive,
    title: 'Create dated workout',
    description: 'Create an empty completed ad-hoc workout with the supplied started_at and completed_at, ISO 8601 instants with explicit time zones and start <= end <= now. It does not occupy the active-workout slot. Add performed sets incrementally with log_sets and read by session_id through get_active_workout. Historical dates and duration stay fixed. Sets appear in history as entered; finish_workout ends entry and releases control. Completion notification proof waits for release and normal app sync; old activity retains its original notification deadline.' + WRITE_RULES,
    inputSchema: z.object({ idempotency_key: operationKey, gym_id: id.nullable().optional(),
      started_at: z.string().min(1).max(40), completed_at: z.string().min(1).max(40) }).strict(),
  }, async (input, extra) => invoke(() => api.writeWorkout(tokenFrom(extra), 'create', input)));

  server.registerTool('start_workout', {
    annotations: additive,
    title: 'Start workout',
    description: 'Start an ad-hoc workout at server time, optionally using a gym ID from get_training_profile. Discover active workouts first. ACTIVE_WORKOUT_CONFLICT means read and choose an existing ID, not automatically finish or replace it. An offline phone workout may not be visible.' + WRITE_RULES,
    inputSchema: z.object({ idempotency_key: operationKey, gym_id: id.nullable().optional() }).strict(),
  }, async (input, extra) => invoke(() => api.writeWorkout(tokenFrom(extra), 'start', input)));

  server.registerTool('log_sets', {
    annotations: additive,
    title: 'Log performed sets',
    description: 'Append 1–30 performed sets to exactly one exercise_id (library definition) or session_exercise_id (existing block). Reuse the returned block ID for later sets; AMBIGUOUS_EXERCISE_BLOCK requires choosing a block from get_active_workout. “Same again” is a new intentional set: resolve the actual previous persisted values and any stated changes, then use a fresh key.' + PERFORMANCE_RULES + WRITE_RULES,
    inputSchema: z.object({ ...writeShape, exercise_id: id.optional(), session_exercise_id: id.optional(),
      sets: z.array(performance).min(1).max(30) }).strict().refine(hasOneWorkoutExerciseReference,
        'Supply exactly one of exercise_id and session_exercise_id.'),
  }, async (input, extra) => invoke(() => api.writeWorkout(tokenFrom(extra), 'log-sets', input)));

  server.registerTool('update_set', {
    annotations: replacing,
    title: 'Correct performed set',
    description: 'Replace explicit performance on one stable set_id in the selected controlled workout. Read the current row first; retain its reps, weight and effort unless the person changes them. Omitting set_type means unspecified, so preserve it explicitly for a weight-only correction. Planned fields and provenance are unchanged.' + PERFORMANCE_RULES + WRITE_RULES,
    inputSchema: z.object({ ...writeShape, set_id: id, set: performance }).strict(),
  }, async (input, extra) => invoke(() => api.writeWorkout(tokenFrom(extra), 'update-set', input)));

  server.registerTool('delete_set', {
    annotations: replacing,
    title: 'Remove performed set',
    description: 'Soft delete one explicitly identified set_id from a controlled ad-hoc workout. Resolve ambiguous phrases such as “the last one” from persisted state and confirm which set is intended.' + WRITE_RULES,
    inputSchema: z.object({ ...writeShape, set_id: id }).strict(),
  }, async (input, extra) => invoke(() => api.writeWorkout(tokenFrom(extra), 'delete-set', input)));

  server.registerTool('finish_workout', {
    annotations: replacing,
    title: 'Finish workout',
    description: 'Finish the selected active ad-hoc workout at server time, or finish entering a dated completed workout and release control without changing its dates or duration. Confirm the person intends to finish; no more chat edits are allowed afterward. Empty workouts may finish. The response contains the persisted completion instant, duration and revision.' + WRITE_RULES,
    inputSchema: z.object(writeShape).strict(),
  }, async (input, extra) => invoke(() => api.writeWorkout(tokenFrom(extra), 'finish', input)));
}
