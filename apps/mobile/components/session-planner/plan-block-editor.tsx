import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField, IconButton, ListRow, uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { EffortChoice } from '@/src/exercise-calculations/effort-policy';
import { Icon } from '@/components/ui/icon';
import { formatSessionSetType, nextSessionSetType, type SessionSetTypeValue } from '@/src/data/set-types';
import type { PlanFormBlock, PlanFormSet } from '@/src/session-planner/plan-form-model';

export type PlanBlockEditorProps = {
  block: PlanFormBlock;
  index: number;
  count: number;
  errors: Map<string, string>;
  onChangeBlock: (blockId: string, patch: Partial<PlanFormBlock>) => void;
  onChangeSet: (blockId: string, setId: string, patch: Partial<PlanFormSet>) => void;
  onAddSet: (blockId: string) => void;
  onRemoveSet: (blockId: string, setId: string) => void;
  onRemoveBlock: (blockId: string) => void;
  onMoveBlock: (blockId: string, step: -1 | 1) => void;
  onPickExercise: (blockId: string) => void;
  /** The account's displayed efforts, cycling the type field like the recorder. */
  displayEfforts?: readonly EffortChoice[];
};

const typeWord = (setType: SessionSetTypeValue) =>
  setType === null ? 'Work' : formatSessionSetType(setType, 'full') ?? 'Work';

/** The effort field's shape (the logger's): a pressable that cycles the type. */
function TypeField({
  blockIndex,
  setIndex,
  setType,
  onCycle,
}: {
  blockIndex: number;
  setIndex: number;
  setType: SessionSetTypeValue;
  onCycle: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Double tap to cycle the set type"
      accessibilityLabel={`Set ${setIndex + 1} type, currently ${typeWord(setType)}`}
      accessibilityRole="button"
      onPress={onCycle}
      style={styles.typeField}
      testID={`plan-form-block-${blockIndex + 1}-set-${setIndex + 1}-type`}>
      <Text allowFontScaling={false} style={styles.typeLabel}>Type</Text>
      <View style={styles.typeValue}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.typeText}>{typeWord(setType)}</Text>
        <Icon color={uiRoles.inkFaint} name="chevron-down" size="xs" />
      </View>
    </Pressable>
  );
}

/**
 * One block's editor in the plan form: the picked exercise (its name row
 * opens the pick sheet), an optional machine note, and the ordered target
 * sets — type, weight, reps per set. The weight field's label follows the
 * exercise's load input mode (`per side · kg` when loaded per side).
 */
export function PlanBlockEditor({
  block,
  index,
  count,
  errors,
  onChangeBlock,
  onChangeSet,
  onAddSet,
  onRemoveSet,
  onRemoveBlock,
  onMoveBlock,
  onPickExercise,
  displayEfforts,
}: PlanBlockEditorProps) {
  const weightLabel = block.loadInputMode === 'per_side_load' ? 'Weight per side · kg' : 'Weight · kg';
  const blockPath = `exercises.${index}`;

  return (
    <View style={styles.block} testID={`plan-form-block-${index + 1}`}>
      <ListRow
        accessibilityLabel={block.name.length > 0 ? `Exercise ${block.name}` : 'Choose exercise'}
        density="list"
        divider={false}
        label={block.name.length > 0 ? block.name : 'Choose exercise'}
        onPress={() => onPickExercise(block.id)}
        testID={`plan-form-block-${index + 1}-pick`}
        trailing={
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
        }
      />
      {errors.get(`${blockPath}.name`) ? (
        <Text allowFontScaling={false} style={styles.error} testID={`plan-form-block-${index + 1}-name-error`}>
          {errors.get(`${blockPath}.name`)}
        </Text>
      ) : null}
      <FormField
        accessibilityLabel={`Machine note for ${block.name || 'exercise'}`}
        autoCapitalize="none"
        label="Machine (optional)"
        onChangeText={(machineName) => onChangeBlock(block.id, { machineName })}
        testID={`plan-form-block-${index + 1}-machine`}
        value={block.machineName}
      />
      {block.sets.map((set, setIndex) => (
        <View key={set.id} style={styles.setRow}>
          <TypeField
            blockIndex={index}
            setIndex={setIndex}
            onCycle={() =>
              onChangeSet(block.id, set.id, {
                targetSetType: nextSessionSetType(set.targetSetType as SessionSetTypeValue, displayEfforts),
              })
            }
            setType={set.targetSetType as SessionSetTypeValue}
          />
          <FormField
            accessibilityLabel={`Set ${setIndex + 1} target weight in kilograms`}
            containerStyle={styles.weightField}
            error={errors.get(`${blockPath}.sets.${setIndex}.targetWeight`)}
            keyboardType="decimal-pad"
            label={weightLabel}
            onChangeText={(text) => onChangeSet(block.id, set.id, { targetWeightText: text })}
            testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-weight`}
            value={set.targetWeightText}
          />
          <FormField
            accessibilityLabel={`Set ${setIndex + 1} target reps`}
            containerStyle={styles.repsField}
            error={errors.get(`${blockPath}.sets.${setIndex}.targetReps`)}
            keyboardType="number-pad"
            label="Reps"
            onChangeText={(text) => onChangeSet(block.id, set.id, { targetRepsText: text })}
            testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-reps`}
            value={set.targetRepsText}
          />
          <View style={styles.setRemove}>
            <IconButton
              accessibilityLabel={`Remove set ${setIndex + 1}`}
              disabled={block.sets.length === 1}
              name="x"
              onPress={() => onRemoveSet(block.id, set.id)}
              testID={`plan-form-block-${index + 1}-set-${setIndex + 1}-remove`}
            />
          </View>
        </View>
      ))}
      {errors.get(`${blockPath}.sets`) ? (
        <Text allowFontScaling={false} style={styles.error}>{errors.get(`${blockPath}.sets`)}</Text>
      ) : null}
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
  block: {
    gap: uiSpace.sm,
    padding: uiSpace.md,
    backgroundColor: uiRoles.paper,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.ruleSoft,
    borderRadius: uiSpace.sm,
  },
  blockActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    alignItems: 'flex-end',
  },
  typeField: {
    width: 96,
    height: uiGeometry.fieldHeight,
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
  },
  typeLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  typeValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  typeText: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  weightField: {
    flex: 1,
  },
  repsField: {
    width: 72,
  },
  setRemove: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: uiRoles.danger,
  },
});
