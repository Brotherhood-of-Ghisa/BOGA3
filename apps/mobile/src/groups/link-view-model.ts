// Pure presentation rules for linking personal exercises to group exercises
// (M25-T07; product E0.1–E0.3, P2, P4, D8; design §7). No I/O: callers pass
// the member's exercises (local catalogue), live links (local
// `exercise_group_links`), and the cached group-exercise catalogues
// (`group_cache`). Linked-state always comes from links, so it renders offline
// and right after a local write; names come from the cache, with placeholders
// when an entry is missing.

import { normalizeExerciseSearchWords } from '@/src/exercise-catalog/search';
import type { LoadInputMode } from '@/src/exercise-core';

import type { GroupExercise } from './types';

/** A personal exercise as the linking UI needs it (a subset of the catalogue row). */
export type LinkableExercise = {
  id: string;
  name: string;
  loadInputMode?: LoadInputMode;
  deletedAt: Date | null;
};

/** A live link row (`listLinks()`). */
export type LinkRef = {
  exerciseDefinitionId: string;
  groupId: string;
  groupExerciseId: string;
};

/** One of my groups (from `groups:mine`) with its cached exercise list; `exercises` is null until cached. */
export type GroupExerciseCatalog = {
  groupId: string;
  groupName: string;
  exercises: GroupExercise[] | null;
};

export const PLACEHOLDER_GROUP_EXERCISE_NAME = 'Group exercise';
export const PLACEHOLDER_GROUP_NAME = 'A group';
export const NOT_LINKED_LABEL = 'not linked';
export const INACTIVE_LINK_LABEL = 'inactive — not a member';
export const ARCHIVED_LINK_LABEL = 'archived';
const SUGGESTED_LIMIT = 3;

const isLive = (exercise: LinkableExercise): boolean => exercise.deletedAt === null;

const byName = (left: { name: string }, right: { name: string }): number =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });

const matchesQuery = (words: string[], ...texts: string[]): boolean => {
  if (words.length === 0) {
    return true;
  }
  const haystack = texts.join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
};

// ---- Notes ------------------------------------------------------------------

export const describeLinkRetroactivity = (exerciseName: string, groupName: string): string =>
  `Your past ${exerciseName} sets shared with ${groupName} will count.`;

export const describeUnlinkConfirm = (groupName: string): string =>
  `Your sets from this exercise will leave ${groupName}'s leaderboards.`;

export const describeAlreadyLinkedIn = (groupName: string): string => `already linked in ${groupName}`;

/** Product "Weight entry" note (D6): null when both modes match. An omitted personal mode is `total_load`. */
export const describeLoadModeNote = (
  myMode: LoadInputMode | undefined,
  groupMode: LoadInputMode,
): string | null => {
  const mine = myMode ?? 'total_load';
  if (mine === groupMode) {
    return null;
  }
  return mine === 'per_side_load'
    ? "Your per-side weights will show doubled on this group's boards."
    : "Your total-load weights will show halved on this group's boards.";
};

// ---- Shared lookups ---------------------------------------------------------

/** Ids of my exercises with a live link in `groupId` (one link per group, P2). */
export const linkedExerciseIdsInGroup = (groupId: string, links: readonly LinkRef[]): Set<string> =>
  new Set(links.filter((link) => link.groupId === groupId).map((link) => link.exerciseDefinitionId));

/**
 * How closely a personal exercise's name matches a group exercise's: 3 equal
 * words, 2 mine contains all of theirs, 1 theirs contains all of mine, 0 no
 * match. Uses the catalogue search normalization (trim, lowercase, words).
 */
export const nameMatchScore = (exerciseName: string, groupExerciseName: string): number => {
  const mine = normalizeExerciseSearchWords(exerciseName);
  const theirs = normalizeExerciseSearchWords(groupExerciseName);
  if (mine.length === 0 || theirs.length === 0) {
    return 0;
  }
  if (mine.join(' ') === theirs.join(' ')) {
    return 3;
  }
  const mineSet = new Set(mine);
  const theirSet = new Set(theirs);
  if (theirs.every((word) => mineSet.has(word))) {
    return 2;
  }
  if (mine.every((word) => theirSet.has(word))) {
    return 1;
  }
  return 0;
};

/**
 * The suggested personal exercise for a group exercise (E0.2): my live exercise
 * whose id is the group exercise's `source_exercise_id` (seeded exercises are
 * `seed_<slug>`), else the best name match; never a deleted exercise or one
 * already linked in that group. Null when nothing qualifies.
 */
export const suggestExerciseForGroupExercise = ({
  groupId,
  groupExercise,
  exercises,
  links,
}: {
  groupId: string;
  groupExercise: GroupExercise;
  exercises: readonly LinkableExercise[];
  links: readonly LinkRef[];
}): LinkableExercise | null => {
  const linkedInGroup = linkedExerciseIdsInGroup(groupId, links);
  const candidates = exercises.filter((exercise) => isLive(exercise) && !linkedInGroup.has(exercise.id));

  const sourceMatch = groupExercise.source_exercise_id
    ? candidates.find((exercise) => exercise.id === groupExercise.source_exercise_id)
    : undefined;
  if (sourceMatch) {
    return sourceMatch;
  }

  let best: { exercise: LinkableExercise; score: number } | null = null;
  for (const exercise of [...candidates].sort(byName)) {
    const score = nameMatchScore(exercise.name, groupExercise.name);
    if (score > 0 && (!best || score > best.score)) {
      best = { exercise, score };
    }
  }
  return best?.exercise ?? null;
};

// ---- Picker (E0.1) ----------------------------------------------------------

export type PickerGroupRow = {
  key: string;
  groupId: string;
  groupName: string;
  groupExercise: GroupExercise;
  /** My live exercises linked to this group exercise. */
  linkedExercises: LinkableExercise[];
  statusLabel: string;
};

export type PickerGroupSection = {
  groupId: string;
  groupName: string;
  rows: PickerGroupRow[];
};

const liveExercisesById = (exercises: readonly LinkableExercise[]): Map<string, LinkableExercise> =>
  new Map(exercises.filter(isLive).map((exercise) => [exercise.id, exercise]));

export const describePickerStatus = (linkedExercises: readonly LinkableExercise[]): string =>
  linkedExercises.length === 0
    ? NOT_LINKED_LABEL
    : `linked: ${linkedExercises.map((exercise) => exercise.name).join(', ')}`;

/**
 * The picker's "From your groups" rows. Empty unless there is search text or
 * the Groups toggle is on (the default picker list never shows group
 * exercises, D9). Archived group exercises and groups whose list isn't cached
 * are left out; a search matches the group exercise name or the group name.
 */
export const buildPickerGroupSections = ({
  catalogs,
  links,
  exercises,
  query,
  groupsOnly,
}: {
  catalogs: readonly GroupExerciseCatalog[] | null;
  links: readonly LinkRef[];
  exercises: readonly LinkableExercise[];
  query: string;
  groupsOnly: boolean;
}): PickerGroupSection[] => {
  const words = normalizeExerciseSearchWords(query);
  if (!catalogs || (!groupsOnly && words.length === 0)) {
    return [];
  }

  const mine = liveExercisesById(exercises);
  const sections: PickerGroupSection[] = [];
  for (const catalog of catalogs) {
    if (!catalog.exercises) {
      continue;
    }
    const rows = catalog.exercises
      .filter((groupExercise) => groupExercise.archived_at_ms === null)
      .filter((groupExercise) => matchesQuery(words, groupExercise.name, catalog.groupName))
      .map((groupExercise): PickerGroupRow => {
        const linkedExercises = links
          .filter(
            (link) => link.groupId === catalog.groupId && link.groupExerciseId === groupExercise.group_exercise_id,
          )
          .map((link) => mine.get(link.exerciseDefinitionId))
          .filter((exercise): exercise is LinkableExercise => exercise !== undefined)
          .sort(byName);
        return {
          key: `${catalog.groupId}:${groupExercise.group_exercise_id}`,
          groupId: catalog.groupId,
          groupName: catalog.groupName,
          groupExercise,
          linkedExercises,
          statusLabel: describePickerStatus(linkedExercises),
        };
      });
    if (rows.length > 0) {
      sections.push({ groupId: catalog.groupId, groupName: catalog.groupName, rows });
    }
  }
  return sections;
};

export type PickerGroupSelection =
  | { kind: 'add'; exercise: LinkableExercise }
  | { kind: 'choose-linked'; exercises: LinkableExercise[] }
  | { kind: 'link' };

/** Picking a group row: one linked exercise adds it; several open the sheet to choose; none opens the pick sheet to link. */
export const resolvePickerGroupSelection = (row: PickerGroupRow): PickerGroupSelection => {
  if (row.linkedExercises.length === 1) {
    return { kind: 'add', exercise: row.linkedExercises[0] };
  }
  if (row.linkedExercises.length > 1) {
    return { kind: 'choose-linked', exercises: row.linkedExercises };
  }
  return { kind: 'link' };
};

// ---- Pick sheet (E0.2) ------------------------------------------------------

export type PickSheetChoice = {
  exercise: LinkableExercise;
  /** Set when the exercise already has a link in this group (one per group, P2). */
  unavailableReason: string | null;
};

export type PickSheetModel = {
  suggestion: LinkableExercise | null;
  /** Every live exercise, by name, for "Choose another of your exercises…". */
  choices: PickSheetChoice[];
  defaultOption: 'suggested' | 'add-new';
};

export const buildPickSheetModel = ({
  groupId,
  groupName,
  groupExercise,
  exercises,
  links,
}: {
  groupId: string;
  groupName: string;
  groupExercise: GroupExercise;
  exercises: readonly LinkableExercise[];
  links: readonly LinkRef[];
}): PickSheetModel => {
  const suggestion = suggestExerciseForGroupExercise({ groupId, groupExercise, exercises, links });
  const linkedInGroup = linkedExerciseIdsInGroup(groupId, links);
  const choices = exercises
    .filter(isLive)
    .slice()
    .sort(byName)
    .map((exercise) => ({
      exercise,
      unavailableReason: linkedInGroup.has(exercise.id) ? describeAlreadyLinkedIn(groupName) : null,
    }));
  return { suggestion, choices, defaultOption: suggestion ? 'suggested' : 'add-new' };
};

/** Pick-sheet "Choose another" search over my live exercises. */
export const filterPickSheetChoices = (choices: readonly PickSheetChoice[], query: string): PickSheetChoice[] => {
  const words = normalizeExerciseSearchWords(query);
  return choices.filter((choice) => matchesQuery(words, choice.exercise.name));
};

// ---- Link screen (E0.3) -----------------------------------------------------

export type LinkScreenLinkedRow = {
  key: string;
  groupId: string;
  groupName: string;
  groupExerciseId: string;
  groupExerciseName: string;
  status: 'active' | 'archived' | 'inactive';
  /** `archived` / `inactive — not a member`; null while active. */
  statusLabel: string | null;
  loadModeNote: string | null;
};

export type LinkScreenAvailableRow = {
  key: string;
  groupId: string;
  groupName: string;
  groupExercise: GroupExercise;
  unavailableReason: string | null;
  loadModeNote: string | null;
};

export type LinkScreenGroup = {
  groupId: string;
  groupName: string;
  rows: LinkScreenAvailableRow[];
};

export type LinkScreenModel = {
  /** False for a soft-deleted exercise: existing links still list (and unlink), nothing new is offered. */
  canLink: boolean;
  linked: LinkScreenLinkedRow[];
  suggested: LinkScreenAvailableRow[];
  groups: LinkScreenGroup[];
};

/**
 * The Link screen for one of my exercises. `catalogs` is null while my groups
 * are unknown (nothing cached yet): links still render, with placeholder
 * names, and nothing is offered. A link into a group missing from a known
 * `catalogs` is inactive (P4); one to an archived group exercise is marked
 * archived (D8). Archived group exercises are never offered. Search filters
 * the offered rows only.
 */
export const buildLinkScreenModel = ({
  exercise,
  catalogs,
  links,
  query,
}: {
  exercise: LinkableExercise;
  catalogs: readonly GroupExerciseCatalog[] | null;
  links: readonly LinkRef[];
  query: string;
}): LinkScreenModel => {
  const catalogById = new Map((catalogs ?? []).map((catalog) => [catalog.groupId, catalog]));
  const myLinks = links.filter((link) => link.exerciseDefinitionId === exercise.id);

  const linked = myLinks
    .map((link): LinkScreenLinkedRow => {
      const catalog = catalogById.get(link.groupId);
      const groupExercise = catalog?.exercises?.find((candidate) => candidate.group_exercise_id === link.groupExerciseId);
      const status: LinkScreenLinkedRow['status'] =
        catalogs !== null && !catalog ? 'inactive' : groupExercise?.archived_at_ms ? 'archived' : 'active';
      return {
        key: `${link.groupId}:${link.groupExerciseId}`,
        groupId: link.groupId,
        groupName: catalog?.groupName ?? PLACEHOLDER_GROUP_NAME,
        groupExerciseId: link.groupExerciseId,
        groupExerciseName: groupExercise?.name ?? PLACEHOLDER_GROUP_EXERCISE_NAME,
        status,
        statusLabel: status === 'inactive' ? INACTIVE_LINK_LABEL : status === 'archived' ? ARCHIVED_LINK_LABEL : null,
        loadModeNote: groupExercise ? describeLoadModeNote(exercise.loadInputMode, groupExercise.load_input_mode) : null,
      };
    })
    .sort((left, right) => left.groupName.localeCompare(right.groupName) || left.groupExerciseName.localeCompare(right.groupExerciseName));

  const canLink = isLive(exercise);
  if (!canLink || !catalogs) {
    return { canLink, linked, suggested: [], groups: [] };
  }

  const words = normalizeExerciseSearchWords(query);
  const linkedGroupIds = new Set(myLinks.map((link) => link.groupId));
  const linkedTargets = new Set(myLinks.map((link) => `${link.groupId}:${link.groupExerciseId}`));
  const scored: { row: LinkScreenAvailableRow; score: number }[] = [];
  const groups: LinkScreenGroup[] = [];

  for (const catalog of catalogs) {
    const rows = (catalog.exercises ?? [])
      .filter((groupExercise) => groupExercise.archived_at_ms === null)
      .filter((groupExercise) => !linkedTargets.has(`${catalog.groupId}:${groupExercise.group_exercise_id}`))
      .filter((groupExercise) => matchesQuery(words, groupExercise.name, catalog.groupName))
      .map(
        (groupExercise): LinkScreenAvailableRow => ({
          key: `${catalog.groupId}:${groupExercise.group_exercise_id}`,
          groupId: catalog.groupId,
          groupName: catalog.groupName,
          groupExercise,
          unavailableReason: linkedGroupIds.has(catalog.groupId) ? describeAlreadyLinkedIn(catalog.groupName) : null,
          loadModeNote: describeLoadModeNote(exercise.loadInputMode, groupExercise.load_input_mode),
        }),
      );
    for (const row of rows) {
      if (row.unavailableReason) {
        continue;
      }
      const score =
        row.groupExercise.source_exercise_id === exercise.id ? 10 : nameMatchScore(exercise.name, row.groupExercise.name);
      if (score > 0) {
        scored.push({ row, score });
      }
    }
    groups.push({ groupId: catalog.groupId, groupName: catalog.groupName, rows });
  }

  const suggested = scored
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.row.groupExercise.name.localeCompare(right.row.groupExercise.name) ||
        left.row.groupName.localeCompare(right.row.groupName),
    )
    .slice(0, SUGGESTED_LIMIT)
    .map(({ row }) => row);
  const suggestedKeys = new Set(suggested.map((row) => row.key));

  return {
    canLink,
    linked,
    suggested,
    groups: groups
      .map((group) => ({ ...group, rows: group.rows.filter((row) => !suggestedKeys.has(row.key)) }))
      .filter((group) => group.rows.length > 0),
  };
};
