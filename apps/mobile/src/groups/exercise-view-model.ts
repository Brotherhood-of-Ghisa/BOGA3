// Pure presentation rules for the group page's Exercises segment (M25-T08;
// `docs/specs/tech/groups-contract.md` §4.4, §6.3): row order, my link status,
// the owner/admin action matrix, archive wording, and the standard-exercise
// search behind "Add exercise". The server stays the authority on who may
// write; these rules only decide what the UI offers.

import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { LOAD_INPUT_MODE_LABELS, type LoadInputMode } from '@/src/exercise-core';

import type { GroupApiError } from './api';
import type { GroupExercise, GroupRole } from './types';
import { canManageGroup, describeGroupWriteError } from './write-view-model';

// ---- Rows ---------------------------------------------------------------------

/** One of my live local links into this group (T03 rows), with my exercise's name when it is on this device. */
export type MyGroupExerciseLink = {
  exerciseDefinitionId: string;
  groupExerciseId: string;
  exerciseName: string | null;
};

export type GroupExerciseRowViewModel = {
  groupExerciseId: string;
  name: string;
  loadInputModeLabel: string;
  archived: boolean;
  /** `Linked: A, B` / `Linked` / `Not linked`; null while my links are still loading. */
  linkStatus: string | null;
  /**
   * Offer "Link your exercise" (E0.4): my links are loaded, none of my
   * exercises is linked to it, and it is active (archived ones are not offered
   * for new links, D8).
   */
  linkable: boolean;
  personalLinks: PersonalExerciseLinkChoice[];
};

export type PersonalExerciseLinkChoice = {
  exerciseDefinitionId: string;
  /** Human-readable identity, including a distinguishing ID for duplicate/missing names. */
  label: string;
};

export const buildPersonalLinkChoices = (links: MyGroupExerciseLink[]): PersonalExerciseLinkChoice[] =>
  links.map((link) => {
    const name = link.exerciseName?.trim() || 'Unnamed personal exercise';
    const ambiguous = !link.exerciseName?.trim() || links.some((other) =>
      other.exerciseDefinitionId !== link.exerciseDefinitionId && other.exerciseName?.trim() === name);
    let length = 8;
    while (length < link.exerciseDefinitionId.length && links.some((other) =>
      other.exerciseDefinitionId !== link.exerciseDefinitionId &&
      other.exerciseDefinitionId.slice(-length) === link.exerciseDefinitionId.slice(-length))) length++;
    return {
      exerciseDefinitionId: link.exerciseDefinitionId,
      label: ambiguous ? `${name} · ${link.exerciseDefinitionId.slice(-length)}` : name,
    };
  }).sort((a, b) => a.label.localeCompare(b.label) || a.exerciseDefinitionId.localeCompare(b.exerciseDefinitionId));

export const NOT_LINKED_STATUS = 'Not linked';

/**
 * My status for one group exercise. Several of my exercises may link to it
 * (product P2); their names are listed alphabetically. A link whose exercise
 * is not on this device reads `Linked` with no name.
 */
export const formatGroupExerciseLinkStatus = (exerciseNames: (string | null)[]): string => {
  if (exerciseNames.length === 0) {
    return NOT_LINKED_STATUS;
  }
  const named = exerciseNames
    .filter((name): name is string => name !== null)
    .sort((left, right) => left.localeCompare(right));
  return named.length === 0 ? 'Linked' : `Linked: ${named.join(', ')}`;
};

/**
 * Active exercises first, then archived ones (D8: kept read-only, marked),
 * each group in server order (`group_exercise_list`: by name). `links` null
 * means my links have not loaded yet.
 */
export const buildGroupExerciseRows = (
  exercises: GroupExercise[],
  links: MyGroupExerciseLink[] | null,
): GroupExerciseRowViewModel[] => {
  const namesByTarget = new Map<string, (string | null)[]>();
  for (const link of links ?? []) {
    const names = namesByTarget.get(link.groupExerciseId) ?? [];
    names.push(link.exerciseName);
    namesByTarget.set(link.groupExerciseId, names);
  }
  const rows = exercises.map((exercise): GroupExerciseRowViewModel => {
    const archived = exercise.archived_at_ms !== null;
    const linkedNames = namesByTarget.get(exercise.group_exercise_id) ?? [];
    return {
      groupExerciseId: exercise.group_exercise_id,
      name: exercise.name,
      loadInputModeLabel: LOAD_INPUT_MODE_LABELS[exercise.load_input_mode],
      archived,
      linkStatus: links === null ? null : formatGroupExerciseLinkStatus(linkedNames),
      linkable: links !== null && !archived && linkedNames.length === 0,
      personalLinks: buildPersonalLinkChoices((links ?? []).filter((link) => link.groupExerciseId === exercise.group_exercise_id)),
    };
  });
  return [...rows.filter((row) => !row.archived), ...rows.filter((row) => row.archived)];
};

/** The notice after "Link your exercise" links one of mine (a local write). */
export const groupExerciseLinkedMessage = (exerciseName: string, groupExerciseName: string): string =>
  `Linked ${exerciseName} to ${groupExerciseName}.`;

// ---- Actions (contract §4.4: owner, admin) --------------------------------------

export type GroupExerciseAction = 'rename' | 'archive' | 'unarchive';

export const GROUP_EXERCISE_ACTION_LABELS: Record<GroupExerciseAction, string> = {
  rename: 'Rename',
  archive: 'Archive',
  unarchive: 'Unarchive',
};

/** Owner and admins: Rename + Archive on an active exercise, Unarchive only on an archived one. Members: nothing. */
export const groupExerciseActionsFor = (
  myRole: GroupRole,
  exercise: Pick<GroupExercise, 'archived_at_ms'>,
): GroupExerciseAction[] => {
  if (!canManageGroup(myRole)) {
    return [];
  }
  return exercise.archived_at_ms === null ? ['rename', 'archive'] : ['unarchive'];
};

/** Archive confirms first (08 destructive action safety pattern); rename and unarchive do not. */
export const groupExerciseArchiveConfirmation = (name: string): { title: string; message: string; confirmLabel: string } => ({
  title: `Archive ${name}?`,
  message:
    "Links and leaderboards stay, read-only, and it's no longer offered for new links. You can unarchive it later.",
  confirmLabel: 'Archive',
});

export const groupExerciseActionSuccessMessage = (action: 'archive' | 'unarchive', name: string): string =>
  action === 'archive' ? `${name} was archived.` : `${name} is active again.`;

/** How a failed exercise write reads. Every write is online-only and changes nothing on failure. */
export const describeGroupExerciseWriteError = (error: GroupApiError): string => {
  switch (error.code) {
    case 'FORBIDDEN':
      return "You're not allowed to do that any more. The list has been refreshed.";
    case 'NOT_FOUND':
      return 'That exercise or group is no longer available. The list has been refreshed.';
    case 'VALIDATION':
      return `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}. Nothing was changed.`;
    default:
      return describeGroupWriteError(error);
  }
};

// ---- Standard catalogue (Add exercise → From catalogue) -------------------------

export type StandardExerciseOption = {
  /** The seed id sent as `p_source_exercise_id` (contract §2.7). */
  sourceExerciseId: string;
  name: string;
  loadInputMode: LoadInputMode;
};

export const STANDARD_EXERCISE_RESULT_LIMIT = 30;

const STANDARD_EXERCISES: StandardExerciseOption[] = SYSTEM_EXERCISE_DEFINITION_SEEDS.map((seed) => ({
  sourceExerciseId: seed.id,
  name: seed.name,
  loadInputMode: seed.loadInputMode,
})).sort((left, right) => left.name.localeCompare(right.name));

/**
 * The bundled standard exercises whose name contains every typed word
 * (case-insensitive), by name, capped at `limit`. `total` counts every match.
 */
export const searchStandardExercises = (
  query: string,
  limit: number = STANDARD_EXERCISE_RESULT_LIMIT,
): { options: StandardExerciseOption[]; total: number } => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = STANDARD_EXERCISES.filter((option) => {
    const name = option.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
  return { options: matches.slice(0, limit), total: matches.length };
};
