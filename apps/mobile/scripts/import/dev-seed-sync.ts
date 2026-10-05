// Shared plumbing for the dev-account seeders (`seed-dev-rich-history.ts`,
// `seed-dev-groups.ts`): the Sync v2 wire entity, password sign-in, and a
// layered, batched `sync_push` — the same path the app pushes through, so the
// server's triggers (the group share trigger included) see a normal client.

import {
  SYSTEM_EXERCISE_DEFINITION_SEEDS,
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '../../src/data/exercise-catalog-seeds';

export type WireValue = string | number | boolean | null;

export type WireEntity = {
  type:
    | 'user_settings'
    | 'body_weight_measurements'
    | 'gyms'
    | 'exercise_definitions'
    | 'muscle_groups'
    | 'exercise_muscle_mappings'
    | 'sessions'
    | 'session_exercises'
    | 'exercise_sets';
  id: string;
  client_updated_at_ms: number;
  fields: Record<string, WireValue>;
};

const BATCH_SIZE = 200;

export const required = (value: string | undefined, label: string) => {
  if (!value || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
};

export const pushUnique = (entities: WireEntity[], seen: Set<string>, entity: WireEntity) => {
  const key = `${entity.type}\0${entity.id}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  entities.push(entity);
};

const timestamps = (atMs: number) => ({ created_at: atMs, updated_at: atMs, deleted_at: null });

/** The starter catalog (muscle groups, exercises, mappings) as one user's rows. */
export const buildSystemCatalogEntities = (atMs: number): WireEntity[] => [
  ...SYSTEM_MUSCLE_GROUP_SEEDS.map((muscleGroup): WireEntity => ({
    type: 'muscle_groups',
    id: muscleGroup.id,
    client_updated_at_ms: atMs,
    fields: {
      display_name: muscleGroup.displayName,
      family_name: muscleGroup.familyName,
      sort_order: muscleGroup.sortOrder,
      is_editable: muscleGroup.isEditable,
      ...timestamps(atMs),
    },
  })),
  ...SYSTEM_EXERCISE_DEFINITION_SEEDS.map((exercise): WireEntity => ({
    type: 'exercise_definitions',
    id: exercise.id,
    client_updated_at_ms: atMs,
    fields: {
      name: exercise.name,
      load_input_mode: exercise.loadInputMode,
      bodyweight_contribution: exercise.bodyweightContribution,
      ...timestamps(atMs),
    },
  })),
  ...SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS.map((mapping): WireEntity => ({
    type: 'exercise_muscle_mappings',
    id: mapping.id,
    client_updated_at_ms: atMs,
    fields: {
      exercise_definition_id: mapping.exerciseDefinitionId,
      muscle_group_id: mapping.muscleGroupId,
      weight: mapping.weight,
      role: mapping.role,
      ...timestamps(atMs),
    },
  })),
];

export const signIn = async (apiUrl: string, anonKey: string, email: string, password: string) => {
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== 'string' || typeof body?.user?.id !== 'string') {
    throw new Error(`Sign-in failed for ${email}: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return { token: body.access_token as string, userId: body.user.id as string };
};

const pushBatch = async (apiUrl: string, anonKey: string, token: string, batch: WireEntity[]) => {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/sync_push`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-profile': 'app_public',
      'content-profile': 'app_public',
      'x-boga-sync-protocol': '4',
    },
    body: JSON.stringify({ entities: batch }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`sync_push failed: HTTP ${response.status} ${body}`);
  }
};

// Layered for the M23 five-layer topology. Only the types this seed emits are
// listed; the plan entities and tag/link tables are not seeded here.
const layerRank = (type: WireEntity['type']) => {
  switch (type) {
    case 'user_settings':
    case 'gyms':
    case 'exercise_definitions':
    case 'muscle_groups':
      return 0;
    case 'exercise_muscle_mappings':
      return 1;
    case 'sessions':
      return 2;
    case 'session_exercises':
      return 3;
    case 'exercise_sets':
    case 'body_weight_measurements':
      return 4;
  }
};

/** Parents before children: a batch never references a row a later batch creates. */
export const sortByLayer = (entities: WireEntity[]) =>
  [...entities].sort((left, right) => layerRank(left.type) - layerRank(right.type));

export const countByType = (entities: WireEntity[]) =>
  entities.reduce<Record<string, number>>((counts, entity) => {
    counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    return counts;
  }, {});

/** Pushes every entity, layered and batched. Returns how many were pushed. */
export const pushEntities = async (apiUrl: string, anonKey: string, token: string, entities: WireEntity[]) => {
  const ordered = sortByLayer(entities);
  for (let index = 0; index < ordered.length; index += BATCH_SIZE) {
    await pushBatch(apiUrl, anonKey, token, ordered.slice(index, index + BATCH_SIZE));
  }
  return ordered.length;
};
