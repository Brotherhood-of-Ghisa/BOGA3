import type { Ref } from 'react';
import type { TextInputInstance } from 'react-native';

import type { LoadContext } from '@/src/exercise-calculations/load-metrics';
import {
  canConfirmSet,
  canDropSet,
  type ExercisePageSet,
  type LoggerValues,
  type SetRowView,
} from '@/src/session-recorder/exercise-page-model';
import type { SessionSetTypeValue } from '@/src/data/set-types';

import { SetLogger } from './set-logger';
import { SetRow } from './set-row';
import { SwipeSetRow } from './swipe-set-row';

export type ExerciseSetRowItemProps = {
  row: SetRowView;
  index: number;
  /** The set the logger sits on, or null when the cursor follows. */
  openSetId: string | null;
  /** The open row's logger values, when its row is on this item. */
  loggerValues: LoggerValues | null;
  loadContext: LoadContext;
  /** The card's live sets, for the open row's per-side offers. */
  allSets: ExercisePageSet[];
  nextSessionSetType: (value: SessionSetTypeValue) => SessionSetTypeValue;
  onChangeLogger: (values: { weightValue?: string; repsValue?: string }) => void;
  onCommit: () => void;
  onOpenEffort: () => void;
  onCycleEffort: (setType: SessionSetTypeValue) => void;
  onSwipeRight: (setId: string) => void;
  onSwipeLeft: (setId: string) => void;
  onOpenRow: (setId: string) => void;
  onToggleRow: (setId: string) => void;
  /** The weight input's ref, for the post-add focus. */
  weightInputRef: Ref<TextInputInstance> | null;
};

/**
 * One row of the exercise page's set list: the open row as the swipeable
 * logger (its sides offered only when they would change the row), every other
 * row as a `SetRow` and its toggle.
 * Pure composition — the writes are the screen's callbacks.
 */
export function ExerciseSetRowItem({
  row,
  index,
  openSetId,
  loggerValues,
  loadContext,
  allSets,
  nextSessionSetType,
  onChangeLogger,
  onCommit,
  onOpenEffort,
  onCycleEffort,
  onSwipeRight,
  onSwipeLeft,
  onOpenRow,
  onToggleRow,
  weightInputRef,
}: ExerciseSetRowItemProps) {
  const open = row.id === openSetId;
  // The hairline hides directly under the open row's logger.
  const followsLogger = index > 0 && allSets[index - 1]?.id === openSetId;
  const divider = index > 0 && !followsLogger;
  if (open && loggerValues) {
    // Only the open row carries the swipes, and each side only when its move
    // would change the row; the accessibility actions are the non-gesture
    // path for the same two moves.
    const onConfirm = canConfirmSet(allSets, row.id) ? () => onSwipeRight(row.id) : undefined;
    const onDrop = canDropSet(allSets, row.id) ? () => onSwipeLeft(row.id) : undefined;
    return (
      <SwipeSetRow onSwipeLeft={onDrop} onSwipeRight={onConfirm} testID={`exercise-set-swipe-${row.number}`}>
        <SetLogger
          loadContext={loadContext}
          number={row.number}
          onChangeReps={(repsValue) => onChangeLogger({ repsValue })}
          onChangeWeight={(weightValue) => onChangeLogger({ weightValue })}
          onCommit={onCommit}
          onConfirm={onConfirm}
          onCycleEffort={() => onCycleEffort(nextSessionSetType(loggerValues.setType))}
          onDrop={onDrop}
          onOpenEffort={onOpenEffort}
          ref={weightInputRef}
          repsValue={loggerValues.repsValue}
          setType={loggerValues.setType}
          weightValue={loggerValues.weightValue}
        />
      </SwipeSetRow>
    );
  }
  return (
    <SetRow
      divider={divider}
      key={row.id}
      onOpen={onOpenRow}
      onToggle={onToggleRow}
      row={row}
    />
  );
}
