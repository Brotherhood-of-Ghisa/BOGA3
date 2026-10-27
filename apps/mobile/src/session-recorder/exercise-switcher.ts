import { isPerformed, type ExercisePageSet } from './exercise-page-model';

type SwitcherBlock = {
  id: string;
  name: string;
  sets: readonly ExercisePageSet[];
};

export type ExerciseSwitcherRow = {
  id: string;
  // 1-based session order, as the session view lists the cards.
  position: number;
  name: string;
  // Confirmed performed sets of all sets — the session view card's done count.
  doneCount: number;
  totalCount: number;
  current: boolean;
};

/**
 * The exercise page title's switcher: every exercise of the session in
 * session order. The open exercise reads from the page's live draft, so a
 * swap or a just-confirmed set shows before the autosave lands.
 */
export const buildExerciseSwitcherRows = (
  sessionBlocks: readonly SwitcherBlock[],
  current: SwitcherBlock
): ExerciseSwitcherRow[] =>
  sessionBlocks.map((loaded, index) => {
    const block = loaded.id === current.id ? current : loaded;
    return {
      id: block.id,
      position: index + 1,
      name: block.name,
      doneCount: block.sets.filter(isPerformed).length,
      totalCount: block.sets.length,
      current: block.id === current.id,
    };
  });
