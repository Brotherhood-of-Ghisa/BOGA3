import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, IconButton, ListRow, Sheet, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { EffortChoice } from '@/src/exercise-calculations/effort-policy';
import { SetEntryFields } from '@/components/exercise-page/set-entry-fields';
import { EffortSheet } from '@/components/exercise-page/exercise-sheets';
import { nextSessionSetType } from '@/src/data/set-types';
import type { PlanFormBlock, PlanFormSet } from '@/src/session-planner/plan-form-model';
import { PlanSetDuplicateForm } from './plan-set-duplicate-form';

export type PlanBlockEditorProps = {
  block: PlanFormBlock;
  index: number;
  count: number;
  errors: Map<string, string>;
  onChangeSet: (blockId: string, setId: string, patch: Partial<PlanFormSet>) => void;
  onAddSet: (blockId: string) => void;
  onDuplicateSet: (blockId: string, setId: string, countText: string) => void;
  onRemoveSet: (blockId: string, setId: string) => void;
  onRemoveBlock: (blockId: string) => void;
  onMoveBlock: (blockId: string, step: -1 | 1) => void;
  onPickExercise: (blockId: string) => void;
  /** A sheet host presents choices in its own body rather than stacking a picker. */
  onOpenEffort?: (blockId: string, setId: string) => void;
  onOpenDuplicate?: (blockId: string, setId: string) => void;
  /** Custom error path prefix, e.g. 'plans.0.exercises'. Defaults to 'exercises'. */
  errorPrefix?: string;
  /** The account's displayed efforts, cycling like the recorder. */
  displayEfforts?: readonly EffortChoice[];
};

/**
 * One block's editor in the plan form: the picked exercise (its name row
 * opens the pick sheet) and the ordered target sets — effort, weight, reps per
 * set. Duplicate asks only for extra copies, inserted after the source with
 * exact values. Target entry follows the shared fields ([[copy.set-entry]]).
 */
export function PlanBlockEditor({
  block,
  index,
  count,
  errors,
  onChangeSet,
  onAddSet,
  onDuplicateSet,
  onRemoveSet,
  onRemoveBlock,
  onMoveBlock,
  onPickExercise,
  onOpenEffort,
  onOpenDuplicate,
  errorPrefix,
  displayEfforts,
}: PlanBlockEditorProps) {
  const [effortSetId, setEffortSetId] = useState<string | null>(null);
  const [duplicateSetId, setDuplicateSetId] = useState<string | null>(null);
  const duplicateSetNumber = block.sets.findIndex((set) => set.id === duplicateSetId) + 1;
  const effortSet = block.sets.find((set) => set.id === effortSetId);
  const prefix = errorPrefix ?? 'exercises';
  const blockPath = `${prefix}.${index}`;

  return (
    <View style={styles.block} testID={`plan-form-block-${index + 1}`}>
      <View style={styles.blockHeader}>
        <Pressable
          accessibilityLabel={block.name.length > 0 ? `Exercise ${block.name}` : 'Choose exercise'}
          accessibilityRole="button"
          onPress={() => onPickExercise(block.id)}
          style={styles.blockPick}
          testID={`plan-form-block-${index + 1}-pick`}>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.blockName}>
            {block.name.length > 0 ? block.name : 'Choose exercise'}
          </Text>
        </Pressable>
        <View style={styles.blockActions}>
          <IconButton
            accessibilityLabel={`Move ${block.name || 'exercise'} up`}
            disabled={index === 0}
            name="arrow-up"
            onPress={() => onMoveBlock(block.id, -1)}
            testID={`plan-form-block-${index + 1}-up`}
          />
          <IconButton
            accessibilityLabel={`Move ${block.name || 'exercise'} down`}
            disabled={index === count - 1}
            name="arrow-down"
            onPress={() => onMoveBlock(block.id, 1)}
            testID={`plan-form-block-${index + 1}-down`}
          />
          <IconButton
            accessibilityLabel={`Remove ${block.name || 'exercise'} from the plan`}
            name="x"
            onPress={() => onRemoveBlock(block.id)}
            testID={`plan-form-block-${index + 1}-remove`}
          />
        </View>
      </View>
      {errors.get(`${blockPath}.name`) ? (
        <Text allowFontScaling={false} style={styles.error} testID={`plan-form-block-${index + 1}-name-error`}>
          {errors.get(`${blockPath}.name`)}
        </Text>
      ) : null}
      {block.sets.map((set, setIndex) => {
        const weightError = errors.get(`${blockPath}.sets.${setIndex}.targetWeight`);
        const repsError = errors.get(`${blockPath}.sets.${setIndex}.targetReps`);
        return (
          <View key={set.id} style={styles.setBlock}>
            <SetEntryFields
              number={setIndex + 1}
              weightValue={set.targetWeightText}
              repsValue={set.targetRepsText}
              setType={set.targetSetType}
              weightError={weightError}
              repsError={repsError}
              onChangeWeight={(targetWeightText) => onChangeSet(block.id, set.id, { targetWeightText })}
              onChangeReps={(targetRepsText) => onChangeSet(block.id, set.id, { targetRepsText })}
              onCycleEffort={() => onChangeSet(block.id, set.id, {
                targetSetType: nextSessionSetType(set.targetSetType, displayEfforts),
              })}
              onOpenEffort={() => {
                Keyboard.dismiss();
                if (onOpenEffort) onOpenEffort(block.id, set.id);
                else setEffortSetId(set.id);
              }}
              testID={`plan-form-block-${index + 1}-set-${setIndex + 1}`}>
              <View style={styles.setRemove}>
                <IconButton
                  accessibilityLabel={`Remove set ${setIndex + 1}`}
                  disabled={block.sets.length === 1}
                  name="x"
                  onPress={() => onRemoveSet(block.id, set.id)}
                  testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-remove`}
                />
              </View>
            </SetEntryFields>
            {weightError ? (
              <Text
                allowFontScaling={false}
                accessibilityLiveRegion="polite"
                style={styles.error}
                testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-weight-error`}>
                {weightError}
              </Text>
            ) : null}
            {repsError ? (
              <Text
                allowFontScaling={false}
                accessibilityLiveRegion="polite"
                style={styles.error}
                testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-reps-error`}>
                {repsError}
              </Text>
            ) : null}
            <View style={styles.duplicateAction}>
              <ActionButton
                accessibilityLabel={`Duplicate set ${setIndex + 1} of ${block.name || 'exercise'}`}
                label="Duplicate"
                onPress={() => {
                  Keyboard.dismiss();
                  if (onOpenDuplicate) onOpenDuplicate(block.id, set.id);
                  else setDuplicateSetId(set.id);
                }}
                size="compact"
                testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-duplicate`}
                variant="outline"
              />
            </View>
          </View>
        );
      })}
      {errors.get(`${blockPath}.sets`) ? (
        <Text allowFontScaling={false} style={styles.error}>{errors.get(`${blockPath}.sets`)}</Text>
      ) : null}
      {onOpenEffort ? null : (
        <EffortSheet
          visible={effortSet !== undefined}
          selected={effortSet?.targetSetType ?? null}
          onSelect={(targetSetType) => {
            if (effortSet) onChangeSet(block.id, effortSet.id, { targetSetType });
            setEffortSetId(null);
          }}
          onDismiss={() => setEffortSetId(null)}
        />
      )}
      {onOpenDuplicate ? null : (
        <Sheet
          dismissLabel="Dismiss set duplication"
          keyboardAvoiding
          onDismiss={() => setDuplicateSetId(null)}
          testID="plan-set-duplicate-sheet"
          title={`Duplicate set ${duplicateSetNumber}`}
          visible={duplicateSetNumber > 0}>
          {duplicateSetId && duplicateSetNumber > 0 ? (
            <View style={styles.duplicateSheetBody}>
              <PlanSetDuplicateForm
                onDuplicate={(countText) => {
                  onDuplicateSet(block.id, duplicateSetId, countText);
                  setDuplicateSetId(null);
                }}
                setCount={block.sets.length}
              />
            </View>
          ) : null}
        </Sheet>
      )}
      <ListRow
        accessibilityLabel={`Add target set to ${block.name || 'exercise'}`}
        density="list"
        divider
        label="Add set"
        onPress={() => onAddSet(block.id)}
        testID={`plan-form-block-${index + 1}-add-set`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  duplicateSheetBody: {
    paddingHorizontal: uiSpace.lg,
  },
  block: {
    gap: uiSpace.sm,
    padding: uiSpace.md,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.card,
  },
  blockActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    minHeight: uiGeometry.tapTarget,
  },
  blockPick: {
    flex: 1,
    minWidth: 0,
    minHeight: uiGeometry.tapTarget,
    justifyContent: 'center',
  },
  blockName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  setBlock: {
    gap: uiSpace.xs,
  },
  duplicateAction: {
    minHeight: uiGeometry.tapTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  setRemove: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.fieldHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.danger,
  },
});
