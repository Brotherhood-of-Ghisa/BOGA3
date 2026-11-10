// Wire validation and normalization for agent session plan and programme mutations.
// Pure functions with no database or HTTP access, mirroring domain validation.

import { isSessionSetType } from '../../../apps/mobile/src/data/set-types.ts';

export const MAX_PLAN_TITLE_LENGTH = 100;
export const MAX_PROGRAMME_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_BLOCK_NAME_LENGTH = 100;
export const MAX_PLAN_BLOCKS = 30;
export const MAX_PLAN_SETS = 30;
export const MIN_PROGRAMME_PLANS = 2;
export const MAX_PROGRAMME_PLANS = 50;
export const MAX_ID_LENGTH = 200;

export class PlanEditError extends Error {}

const fail = (message: string): never => {
  throw new PlanEditError(message);
};

export type JsonObject = Record<string, unknown>;

const asObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
};

const rejectUnknownKeys = (body: JsonObject, allowed: ReadonlySet<string>): void => {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fail(`Unsupported field: ${key}`);
  }
};

export const readBaseVersion = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail('base_version is required.');
  }
  return value.trim();
};

export const readId = (value: unknown, label: string): string => {
  if (typeof value !== 'string') return fail(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_ID_LENGTH) {
    return fail(`${label} must be 1 to ${MAX_ID_LENGTH} characters.`);
  }
  return trimmed;
};

const readOptionalId = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) return null;
  return readId(value, label);
};

export const readTitle = (value: unknown, maxLen: number, label: string): string => {
  if (typeof value !== 'string') return fail(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maxLen) {
    return fail(`${label} must be 1 to ${maxLen} characters.`);
  }
  return trimmed;
};

const readOptionalTitle = (value: unknown, maxLen: number, label: string): string | null => {
  if (value === undefined || value === null) return null;
  return readTitle(value, maxLen, label);
};

const readOptionalDescription = (value: unknown, maxLen: number, label: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(`${label} must be a string.`);
  if (value.length > maxLen) {
    return fail(`${label} must not exceed ${maxLen} characters.`);
  }
  return value;
};

const readOptionalEpochMs = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      return fail(`${label} must be a valid positive epoch millisecond timestamp.`);
    }
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fail(`${label} must be a valid ISO 8601 or epoch timestamp.`);
    }
    return parsed;
  }
  return fail(`${label} must be a timestamp.`);
};

export const readTargetWeight = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'number'
    ? String(value)
    : typeof value === 'string' ? value.trim() : null;
  if (text === null || !/^\d{1,4}(\.\d{1,2})?$/.test(text)) {
    return fail(`${label} must be a non-negative decimal up to 9999.99.`);
  }
  return text;
};

export const readTargetReps = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 999) {
    return fail(`${label} must be an integer between 1 and 999.`);
  }
  return value;
};

export const readTargetSetType = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(`${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!isSessionSetType(trimmed)) {
    return fail(`${label} is not a supported set type.`);
  }
  return trimmed;
};

export type PlanSetInput = {
  id?: string;
  target_reps: number;
  target_set_type?: string | null;
  target_weight_value?: string | null;
};

export const normalizeSetInput = (value: unknown, label: string): PlanSetInput => {
  const obj = asObject(value, label);
  rejectUnknownKeys(obj, new Set(['id', 'target_reps', 'target_set_type', 'target_weight_value', 'target_weight']));
  const targetReps = readTargetReps(obj.target_reps, `${label}.target_reps`);
  const rawWeight = obj.target_weight_value ?? obj.target_weight;
  const targetWeight = readTargetWeight(rawWeight, `${label}.target_weight_value`);
  const targetSetType = readTargetSetType(obj.target_set_type, `${label}.target_set_type`);
  const id = readOptionalId(obj.id, `${label}.id`);
  return {
    ...(id ? { id } : {}),
    target_reps: targetReps,
    ...(targetWeight !== null ? { target_weight_value: targetWeight } : {}),
    ...(targetSetType !== null ? { target_set_type: targetSetType } : {}),
  };
};

export type PlanBlockInput = {
  exercise_definition_id?: string | null;
  name?: string;
  sets?: PlanSetInput[];
};

export const normalizeBlockInput = (
  value: unknown,
  label: string,
  requireSets = true,
  allowExerciseIdAsDefinition = true,
  extraAllowed?: ReadonlySet<string>,
): PlanBlockInput => {
  const obj = asObject(value, label);
  const allowed = new Set([
    'name',
    'exercise_definition_id',
    ...(allowExerciseIdAsDefinition ? ['exercise_id'] : []),
    'sets',
    ...(extraAllowed ?? []),
  ]);
  rejectUnknownKeys(obj, allowed);
  const name = readOptionalTitle(obj.name, MAX_BLOCK_NAME_LENGTH, `${label}.name`);
  const hasExerciseDefinition =
    Object.prototype.hasOwnProperty.call(obj, 'exercise_definition_id') ||
    (allowExerciseIdAsDefinition && Object.prototype.hasOwnProperty.call(obj, 'exercise_id'));
  const rawDefId = obj.exercise_definition_id !== undefined
    ? obj.exercise_definition_id
    : (allowExerciseIdAsDefinition ? obj.exercise_id : undefined);
  const exerciseDefinitionId = hasExerciseDefinition
    ? readOptionalId(rawDefId, `${label}.exercise_definition_id`)
    : undefined;

  let sets: PlanSetInput[] | undefined;
  if (obj.sets !== undefined) {
    if (!Array.isArray(obj.sets)) return fail(`${label}.sets must be an array.`);
    const rawSets = obj.sets as unknown[];
    if (rawSets.length < 1 || rawSets.length > MAX_PLAN_SETS) {
      return fail(`${label}.sets must contain 1 to ${MAX_PLAN_SETS} sets.`);
    }
    sets = rawSets.map((setEntry, i) => normalizeSetInput(setEntry, `${label}.sets[${i}]`));
  } else if (requireSets) {
    return fail(`${label}.sets is required.`);
  }

  if (requireSets) {
    if (!name && !exerciseDefinitionId) {
      return fail(`${label} must provide either name or exercise_definition_id.`);
    }
  } else {
    if (!name && !hasExerciseDefinition && sets === undefined) {
      return fail(`${label} must provide at least one field to update (name, exercise_definition_id, or sets).`);
    }
  }

  return {
    ...(name !== null ? { name } : {}),
    ...(hasExerciseDefinition ? { exercise_definition_id: exerciseDefinitionId } : {}),
    ...(sets !== undefined ? { sets } : {}),
  };
};

// ---------------------------------------------------------------------------
// Plan mutation payloads
// ---------------------------------------------------------------------------

export type PlanMetaPatch = {
  gym_id?: string | null;
  scheduled_for?: number | null;
  title?: string;
};

export type PlanMutation =
  | { kind: 'update_plan_meta'; base_version: string; patch: PlanMetaPatch }
  | { kind: 'insert_plan_block'; base_version: string; block: PlanBlockInput }
  | { kind: 'update_plan_block'; base_version: string; exercise_id: string; block: PlanBlockInput }
  | { kind: 'reorder_plan_blocks'; base_version: string; exercise_ids: string[] }
  | { kind: 'reorder_block_sets'; base_version: string; exercise_id: string; set_ids: string[] }
  | { kind: 'tombstone_plan_block'; base_version: string; exercise_id: string }
  | { kind: 'tombstone_plan'; base_version: string };

const parsePlanMetaPatch = (body: JsonObject): PlanMetaPatch => {
  const isNested = body.patch !== undefined;
  const source = isNested ? asObject(body.patch, 'patch') : body;
  const allowed = new Set([
    'title',
    'gym_id',
    'scheduled_for',
    ...(isNested ? [] : ['operation', 'base_version']),
  ]);
  rejectUnknownKeys(source, allowed);

  const title = readOptionalTitle(source.title, MAX_PLAN_TITLE_LENGTH, 'title');
  const gymId = source.gym_id !== undefined ? readOptionalId(source.gym_id, 'gym_id') : undefined;
  const scheduledFor = source.scheduled_for !== undefined ? readOptionalEpochMs(source.scheduled_for, 'scheduled_for') : undefined;

  if (title === null && gymId === undefined && scheduledFor === undefined) {
    return fail('patch must update at least one field (title, gym_id, or scheduled_for).');
  }

  const patch: PlanMetaPatch = {};
  if (title !== null) patch.title = title;
  if (gymId !== undefined) patch.gym_id = gymId;
  if (scheduledFor !== undefined) patch.scheduled_for = scheduledFor;
  return patch;
};

export const normalizePlanMutation = (body: JsonObject): PlanMutation => {
  const baseVersion = readBaseVersion(body.base_version);
  const operation = typeof body.operation === 'string' ? body.operation.trim() : null;

  // 1. Explicit operation if provided
  if (operation) {
    switch (operation) {
      case 'update_plan_meta':
      case 'update_meta': {
        const patch = parsePlanMetaPatch(body);
        return { kind: 'update_plan_meta', base_version: baseVersion, patch };
      }
      case 'insert_plan_block':
      case 'add_plan_block':
      case 'insert_block':
      case 'add_block': {
        const isNested = body.block !== undefined;
        const blockSource = isNested ? body.block : body;
        const block = normalizeBlockInput(
          blockSource,
          'block',
          true,
          true,
          isNested ? undefined : new Set(['operation', 'base_version']),
        );
        return { kind: 'insert_plan_block', base_version: baseVersion, block };
      }
      case 'update_plan_block':
      case 'edit_plan_block':
      case 'update_block':
      case 'edit_block': {
        const exerciseId = readId(body.exercise_id ?? body.block_id, 'exercise_id');
        const isNested = body.block !== undefined || body.patch !== undefined;
        const blockSource = body.block !== undefined ? body.block : body.patch !== undefined ? body.patch : body;
        const block = normalizeBlockInput(
          blockSource,
          'block',
          false,
          false,
          isNested ? undefined : new Set(['operation', 'base_version', 'exercise_id', 'block_id']),
        );
        return { kind: 'update_plan_block', base_version: baseVersion, exercise_id: exerciseId, block };
      }
      case 'reorder_plan_blocks':
      case 'reorder_blocks': {
        const ids = body.exercise_ids ?? body.block_ids;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PLAN_BLOCKS) {
          return fail(`exercise_ids must be an array of 1 to ${MAX_PLAN_BLOCKS} block IDs.`);
        }
        const exerciseIds = (ids as unknown[]).map((id, i) => readId(id, `exercise_ids[${i}]`));
        return { kind: 'reorder_plan_blocks', base_version: baseVersion, exercise_ids: exerciseIds };
      }
      case 'reorder_block_sets':
      case 'reorder_sets': {
        const exerciseId = readId(body.exercise_id ?? body.block_id, 'exercise_id');
        const ids = body.set_ids;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PLAN_SETS) {
          return fail(`set_ids must be an array of 1 to ${MAX_PLAN_SETS} set IDs.`);
        }
        const setIds = (ids as unknown[]).map((id, i) => readId(id, `set_ids[${i}]`));
        return { kind: 'reorder_block_sets', base_version: baseVersion, exercise_id: exerciseId, set_ids: setIds };
      }
      case 'tombstone_plan_block':
      case 'remove_plan_block':
      case 'remove_block':
      case 'delete_block': {
        const exerciseId = readId(body.exercise_id ?? body.block_id, 'exercise_id');
        return { kind: 'tombstone_plan_block', base_version: baseVersion, exercise_id: exerciseId };
      }
      case 'tombstone_plan':
      case 'remove_plan':
      case 'delete_plan': {
        return { kind: 'tombstone_plan', base_version: baseVersion };
      }
      default:
        return fail(`Unsupported plan edit operation: ${operation}`);
    }
  }

  // 2. Inferred operation from fields
  const exerciseId = body.exercise_id ?? body.block_id;
  const isDeleted = body.deleted === true || body.remove === true;

  if (isDeleted) {
    if (exerciseId !== undefined && exerciseId !== null) {
      return { kind: 'tombstone_plan_block', base_version: baseVersion, exercise_id: readId(exerciseId, 'exercise_id') };
    }
    return { kind: 'tombstone_plan', base_version: baseVersion };
  }

  if (body.exercise_ids !== undefined || body.block_ids !== undefined) {
    const ids = body.exercise_ids ?? body.block_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PLAN_BLOCKS) {
      return fail(`exercise_ids must be an array of 1 to ${MAX_PLAN_BLOCKS} block IDs.`);
    }
    const exerciseIds = (ids as unknown[]).map((id, i) => readId(id, `exercise_ids[${i}]`));
    return { kind: 'reorder_plan_blocks', base_version: baseVersion, exercise_ids: exerciseIds };
  }

  if (body.set_ids !== undefined) {
    if (exerciseId === undefined || exerciseId === null) {
      return fail('exercise_id is required to reorder sets.');
    }
    const ids = body.set_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_PLAN_SETS) {
      return fail(`set_ids must be an array of 1 to ${MAX_PLAN_SETS} set IDs.`);
    }
    const setIds = (ids as unknown[]).map((id, i) => readId(id, `set_ids[${i}]`));
    return { kind: 'reorder_block_sets', base_version: baseVersion, exercise_id: readId(exerciseId, 'exercise_id'), set_ids: setIds };
  }

  if (exerciseId !== undefined && exerciseId !== null) {
    const isNested = body.block !== undefined || body.patch !== undefined;
    const blockSource = body.block !== undefined ? body.block : body.patch !== undefined ? body.patch : body;
    const block = normalizeBlockInput(
      blockSource,
      'block',
      false,
      false,
      isNested ? undefined : new Set(['operation', 'base_version', 'exercise_id', 'block_id']),
    );
    return { kind: 'update_plan_block', base_version: baseVersion, exercise_id: readId(exerciseId, 'exercise_id'), block };
  }

  if (body.block !== undefined) {
    const block = normalizeBlockInput(body.block, 'block', true, true);
    return { kind: 'insert_plan_block', base_version: baseVersion, block };
  }

  if (body.title !== undefined || body.gym_id !== undefined || body.scheduled_for !== undefined || body.patch !== undefined) {
    const patch = parsePlanMetaPatch(body);
    return { kind: 'update_plan_meta', base_version: baseVersion, patch };
  }

  return fail('Unable to determine plan edit operation from request payload.');
};

// ---------------------------------------------------------------------------
// Programme mutation payloads
// ---------------------------------------------------------------------------

export type ProgrammeMetaPatch = {
  description?: string | null;
  name?: string;
};

export type ProgrammeMutation =
  | { kind: 'update_programme_meta'; base_version: string; patch: ProgrammeMetaPatch }
  | { kind: 'reorder_programme_plans'; base_version: string; plan_ids: string[] }
  | { kind: 'detach_programme_plan'; base_version: string; plan_id: string }
  | { kind: 'tombstone_programme'; base_version: string };

const parseProgrammeMetaPatch = (body: JsonObject): ProgrammeMetaPatch => {
  const isNested = body.patch !== undefined;
  const source = isNested ? asObject(body.patch, 'patch') : body;
  const allowed = new Set([
    'name',
    'description',
    ...(isNested ? [] : ['operation', 'base_version']),
  ]);
  rejectUnknownKeys(source, allowed);

  const name = readOptionalTitle(source.name, MAX_PROGRAMME_NAME_LENGTH, 'name');
  const description = source.description !== undefined
    ? readOptionalDescription(source.description, MAX_DESCRIPTION_LENGTH, 'description')
    : undefined;

  if (name === null && description === undefined) {
    return fail('patch must update at least one field (name or description).');
  }

  const patch: ProgrammeMetaPatch = {};
  if (name !== null) patch.name = name;
  if (description !== undefined) patch.description = description;
  return patch;
};

export const normalizeProgrammeMutation = (body: JsonObject): ProgrammeMutation => {
  const baseVersion = readBaseVersion(body.base_version);
  const operation = typeof body.operation === 'string' ? body.operation.trim() : null;

  // 1. Explicit operation if provided
  if (operation) {
    switch (operation) {
      case 'update_programme_meta':
      case 'update_meta': {
        const patch = parseProgrammeMetaPatch(body);
        return { kind: 'update_programme_meta', base_version: baseVersion, patch };
      }
      case 'reorder_programme_plans':
      case 'reorder_plans': {
        const ids = body.plan_ids;
        if (!Array.isArray(ids) || ids.length < MIN_PROGRAMME_PLANS || ids.length > MAX_PROGRAMME_PLANS) {
          return fail(`plan_ids must be an array of ${MIN_PROGRAMME_PLANS} to ${MAX_PROGRAMME_PLANS} plan IDs.`);
        }
        const planIds = (ids as unknown[]).map((id, i) => readId(id, `plan_ids[${i}]`));
        return { kind: 'reorder_programme_plans', base_version: baseVersion, plan_ids: planIds };
      }
      case 'detach_programme_plan':
      case 'detach_plan': {
        const planId = readId(body.plan_id, 'plan_id');
        return { kind: 'detach_programme_plan', base_version: baseVersion, plan_id: planId };
      }
      case 'tombstone_programme':
      case 'remove_programme':
      case 'delete_programme': {
        return { kind: 'tombstone_programme', base_version: baseVersion };
      }
      default:
        return fail(`Unsupported programme edit operation: ${operation}`);
    }
  }

  // 2. Inferred operation from fields
  const isDeleted = body.deleted === true || body.remove === true;
  if (isDeleted) {
    return { kind: 'tombstone_programme', base_version: baseVersion };
  }

  if (body.plan_ids !== undefined) {
    const ids = body.plan_ids;
    if (!Array.isArray(ids) || ids.length < MIN_PROGRAMME_PLANS || ids.length > MAX_PROGRAMME_PLANS) {
      return fail(`plan_ids must be an array of ${MIN_PROGRAMME_PLANS} to ${MAX_PROGRAMME_PLANS} plan IDs.`);
    }
    const planIds = (ids as unknown[]).map((id, i) => readId(id, `plan_ids[${i}]`));
    return { kind: 'reorder_programme_plans', base_version: baseVersion, plan_ids: planIds };
  }

  if (body.plan_id !== undefined && body.plan_id !== null) {
    return { kind: 'detach_programme_plan', base_version: baseVersion, plan_id: readId(body.plan_id, 'plan_id') };
  }

  if (body.name !== undefined || body.description !== undefined || body.patch !== undefined) {
    const patch = parseProgrammeMetaPatch(body);
    return { kind: 'update_programme_meta', base_version: baseVersion, patch };
  }

  return fail('Unable to determine programme edit operation from request payload.');
};
