import { planScheduleLabel, planFormBlockFromEmptySet, planFormBlockFromSuggestion, addPlanFormSets, formatScheduleText, type PlanFormBlock, type PlanFormSet } from '@/src/session-planner/plan-form-model';
import { useDateFormat, useAccountLocalPreferenceState } from '@/src/preferences/hooks';

import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  FormField,
  IconButton,
  ListRow,
  Notice,
  FigureText,
  PageSheet,
  uiRoles,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { PlanBlockEditor } from '@/components/session-planner/plan-block-editor';
import { PlanSetAddForm } from '@/components/session-planner/plan-set-add-form';
import { EffortChoices } from '@/components/exercise-page/exercise-sheets';
import { PlanExercisePickSheet, type PlanExercisePickResult } from '@/components/session-planner/plan-exercise-pick-sheet';
import { PlanGymSheet, type SaveOutcome } from '@/components/session-planner/plan-form-screen';
import { PlanScheduleSheet } from '@/components/session-planner/plan-schedule-sheet';
import {
  emptyProgrammeChildPlan,
  programmeFormErrors,
  type ProgrammeChildPlanForm,
  type ProgrammeFormState,
} from '@/src/session-planner';

import { parseSessionDateTime } from '@/src/utils/local-time';
import { listSessionGymOptions, type SessionGymOption } from '@/src/session-recorder/gym-options';
import type { EffortChoice } from '@/src/exercise-calculations/effort-policy';

export type ProgrammeFormScreenProps = {
  initialForm: ProgrammeFormState;
  onSave: (form: ProgrammeFormState) => Promise<SaveOutcome>;
  saveLabel: string;
};

/**
 * One child plan's block and set edits, as patches to that plan. Pure: every
 * edit is a `blocks` patch the form's reducer applies, so the sheet holds no
 * block state of its own.
 */
const childPlanBlockEdits = (
  plan: ProgrammeChildPlanForm,
  planIndex: number,
  onUpdatePlan: (index: number, patch: Partial<ProgrammeChildPlanForm>) => void,
  displayEfforts: readonly EffortChoice[],
) => {
  const patchBlocks = (blocks: PlanFormBlock[]) => onUpdatePlan(planIndex, { blocks });
  const mapBlock = (blockId: string, map: (block: PlanFormBlock) => PlanFormBlock) =>
    patchBlocks(plan.blocks.map((block) => (block.id === blockId ? map(block) : block)));
  const updateBlock = (blockId: string, patch: Partial<PlanFormBlock>) =>
    mapBlock(blockId, (block) => ({ ...block, ...patch }));
  return {
    updateSet: (blockId: string, setId: string, patch: Partial<PlanFormSet>) =>
      mapBlock(blockId, (block) => ({
        ...block,
        sets: block.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
      })),
    addSets: (blockId: string, countText: string) =>
      mapBlock(blockId, (block) => ({ ...block, sets: addPlanFormSets(block.sets, countText) })),
    // The last set stays: a block always keeps at least one target.
    removeSet: (blockId: string, setId: string) =>
      mapBlock(blockId, (block) =>
        block.sets.length > 1 ? { ...block, sets: block.sets.filter((set) => set.id !== setId) } : block
      ),
    pickExercise: (blockId: string | null, { exercise, suggestion }: PlanExercisePickResult) => {
      const hasSuggestion = suggestion && suggestion.sets.length > 0;
      const block = hasSuggestion
        ? planFormBlockFromSuggestion(exercise, suggestion.sets, displayEfforts)
        : planFormBlockFromEmptySet(exercise, displayEfforts);
      if (blockId === null) patchBlocks([...plan.blocks, block]);
      else updateBlock(blockId, {
        exerciseDefinitionId: exercise.id,
        name: exercise.name,
        loadInputMode: exercise.loadInputMode,
        sets: block.sets,
      });
    },
    removeBlock: (blockId: string) => {
      patchBlocks(plan.blocks.filter((b) => b.id !== blockId));
    },
    moveBlock: (blockId: string, step: -1 | 1) => {
      const fromIndex = plan.blocks.findIndex((b) => b.id === blockId);
      const toIndex = fromIndex + step;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= plan.blocks.length) return;
      const reordered = [...plan.blocks];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      patchBlocks(reordered);
    },
  };
};

type ProgrammeSessionEditSheetProps = {
  plan: ProgrammeChildPlanForm | null;
  planIndex: number | null;
  visible: boolean;
  errors: Map<string, string>;
  onDismiss: () => void;
  onUpdatePlan: (index: number, patch: Partial<ProgrammeChildPlanForm>) => void;
};

type ProgrammeChildPlanBlocksProps = {
  blocks: PlanFormBlock[];
  prefix: string;
  errors: Map<string, string>;
  displayEfforts: readonly EffortChoice[];
  onAddBlock: () => void;
  onAddSets: (blockId: string, countText: string) => void;
  onChangeSet: (blockId: string, setId: string, patch: Partial<PlanFormSet>) => void;
  onMoveBlock: (blockId: string, step: -1 | 1) => void;
  onPickExercise: (id: string) => void;
  onOpenEffort: (blockId: string, setId: string) => void;
  onOpenAddSets: (blockId: string) => void;
  onRemoveBlock: (blockId: string) => void;
  onRemoveSet: (blockId: string, setId: string) => void;
};

function ProgrammeChildPlanBlocks({
  blocks,
  prefix,
  errors,
  displayEfforts,
  onAddBlock,
  onAddSets,
  onChangeSet,
  onMoveBlock,
  onPickExercise,
  onOpenEffort,
  onOpenAddSets,
  onRemoveBlock,
  onRemoveSet,
}: ProgrammeChildPlanBlocksProps) {
  return (
    <View style={styles.fieldBlock}>
      <View style={styles.blocksHeader}>
        <Text allowFontScaling={false} accessibilityRole="header" style={uiText.label}>
          Exercise blocks
        </Text>
        <ActionButton
          accessibilityLabel="Add exercise block"
          label="+ Add exercise"
          onPress={onAddBlock}
          testID="programme-child-plan-add-block"
          variant="outline"
        />
      </View>

      {blocks.map((block, blockIdx) => (
        <PlanBlockEditor
          block={block}
          count={blocks.length}
          displayEfforts={displayEfforts}
          errorPrefix={`${prefix}.exercises`}
          errors={errors}
          index={blockIdx}
          key={block.id}
          onAddSets={onAddSets}
          onChangeSet={onChangeSet}
          onMoveBlock={onMoveBlock}
          onPickExercise={onPickExercise}
          onOpenEffort={onOpenEffort}
          onOpenAddSets={onOpenAddSets}
          onRemoveBlock={onRemoveBlock}
          onRemoveSet={onRemoveSet}
        />
      ))}
      {blocks.length === 0 ? (
        <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]} testID="programme-child-plan-blocks-empty">
          A session needs at least one exercise.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Child session editor sheet: isolates the full block/target set editor
 * to one child session at a time, avoiding an unbounded mega-form on mobile.
 */
function ProgrammeSessionEditSheet({
  plan,
  planIndex,
  visible,
  errors,
  onDismiss,
  onUpdatePlan,
}: ProgrammeSessionEditSheetProps) {
  const dateFormat = useDateFormat();
  const [gyms, setGyms] = useState<SessionGymOption[] | null>(null);
  const [gymSheetVisible, setGymSheetVisible] = useState(false);
  const [scheduleSheetVisible, setScheduleSheetVisible] = useState(false);
  const [pickBlockId, setPickBlockId] = useState<string | null>(null);
  const [isPickingNew, setIsPickingNew] = useState(false);
  const [effortRequest, setEffortRequest] = useState<{ blockId: string; setId: string } | null>(null);
  const [addSetsBlockId, setAddSetsBlockId] = useState<string | null>(null);
  const { values: trainingPreferences } = useAccountLocalPreferenceState();

  if (!plan || planIndex === null) {
    return null;
  }

  const prefix = `plans.${planIndex}`;
  const effortSet = plan.blocks.find((block) => block.id === effortRequest?.blockId)
    ?.sets.find((set) => set.id === effortRequest?.setId);
  const addSetsBlock = plan.blocks.find((block) => block.id === addSetsBlockId);
  const dismiss = () => {
    setEffortRequest(null);
    setAddSetsBlockId(null);
    onDismiss();
  };

  const openGymPicker = async () => {
    setGymSheetVisible(true);
    if (gyms === null) {
      try {
        setGyms(await listSessionGymOptions());
      } catch {
        setGyms([]);
      }
    }
  };

  const selectedGymName =
    plan.gymId === null ? 'No gym' : gyms?.find((g) => g.id === plan.gymId)?.name ?? 'Gym chosen';
  const childScheduleSummary =
    planScheduleLabel(plan.scheduleText, dateFormat);

  const { updateSet, addSets, removeSet, pickExercise, removeBlock, moveBlock } =
    childPlanBlockEdits(plan, planIndex, onUpdatePlan, trainingPreferences.displayEfforts);

  const onPickExercise = (blockId: string | null, result: PlanExercisePickResult) => {
    pickExercise(blockId, result);
    setPickBlockId(null);
    setIsPickingNew(false);
  };

  return (
    <PageSheet
      closeLabel="Close session editor"
      headerLeading={effortSet || addSetsBlock ? (
        <IconButton
          accessibilityLabel="Back to session"
          name="chevron-left"
          onPress={() => { Keyboard.dismiss(); setEffortRequest(null); setAddSetsBlockId(null); }}
          testID={effortSet ? 'programme-child-plan-effort-back' : 'programme-child-plan-add-sets-back'}
        />
      ) : undefined}
      keyboardAvoiding
      onDismiss={dismiss}
      testID="programme-child-plan-editor-sheet"
      title={effortSet ? 'Effort' : addSetsBlock ? 'Add set(s)' : `Edit ${plan.title || 'Session'}`}
      visible={visible}>
      {effortRequest && effortSet ? (
        <View style={styles.childEditorBody}>
          <EffortChoices
            selected={effortSet.targetSetType}
            onSelect={(targetSetType) => {
              updateSet(effortRequest.blockId, effortSet.id, { targetSetType });
              setEffortRequest(null);
            }}
          />
        </View>
      ) : null}
      {addSetsBlock ? (
        <View style={styles.childEditorBody}>
          <PlanSetAddForm
            onAddSets={(countText) => {
              addSets(addSetsBlock.id, countText);
              setAddSetsBlockId(null);
            }}
            setCount={addSetsBlock.sets.length}
          />
        </View>
      ) : null}
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={[styles.childEditorScroll, effortSet || addSetsBlock ? styles.hidden : null]}
        testID="programme-child-plan-editor-scroll">
        <View style={styles.childEditorBody} testID="programme-child-plan-editor-body">
          <FormField
            accessibilityLabel="Session title"
            error={errors.get(`${prefix}.title`)}
            label="Session title"
            onChangeText={(text) => onUpdatePlan(planIndex, { title: text })}
            placeholder="e.g. Day 1: Squat"
            testID="programme-child-plan-title-input"
            value={plan.title}
          />

          <View style={styles.fieldBlock}>
            <Text allowFontScaling={false} style={uiText.label}>
              Schedule (optional)
            </Text>
            <Card>
              <ListRow
                accessibilityLabel={`Schedule: ${childScheduleSummary}`}
                density="list"
                divider={false}
                label={childScheduleSummary}
                onPress={() => setScheduleSheetVisible(true)}
                testID="programme-child-plan-schedule-row"
              />
            </Card>
          </View>

          <View style={styles.fieldBlock}>
            <Text allowFontScaling={false} style={uiText.label}>
              Gym
            </Text>
            <Card>
              <ListRow
                accessibilityLabel={`Gym: ${selectedGymName}`}
                density="list"
                divider={false}
                label={selectedGymName}
                onPress={openGymPicker}
                testID="programme-child-plan-gym-row"
              />
            </Card>
          </View>

          <ProgrammeChildPlanBlocks
            blocks={plan.blocks}
            displayEfforts={trainingPreferences.displayEfforts}
            errors={errors}
            onAddBlock={() => setIsPickingNew(true)}
            onAddSets={addSets}
            onChangeSet={updateSet}
            onMoveBlock={moveBlock}
            onOpenAddSets={setAddSetsBlockId}
            onOpenEffort={(blockId, setId) => setEffortRequest({ blockId, setId })}
            onPickExercise={(id) => setPickBlockId(id)}
            onRemoveBlock={removeBlock}
            onRemoveSet={removeSet}
            prefix={prefix}
          />

          <ActionButton
            accessibilityLabel="Done editing session"
            label="Done"
            onPress={dismiss}
            testID="programme-child-plan-done-button"
            variant="primary"
          />

          <PlanGymSheet
            gyms={gyms}
            onDismiss={() => setGymSheetVisible(false)}
            onPick={(gymId) => {
              onUpdatePlan(planIndex, { gymId });
              setGymSheetVisible(false);
            }}
            visible={gymSheetVisible}
          />

          <PlanScheduleSheet
            currentSchedule={plan.scheduleText.trim().length > 0 ? parseSessionDateTime(plan.scheduleText) : null}
            onConfirm={(date) => {
              onUpdatePlan(planIndex, { scheduleText: date ? formatScheduleText(date) : '' });
            }}
            onDismiss={() => setScheduleSheetVisible(false)}
            visible={scheduleSheetVisible}
          />

          <PlanExercisePickSheet
            gymId={plan.gymId}
            onDismiss={() => {
              setPickBlockId(null);
              setIsPickingNew(false);
            }}
            onPick={onPickExercise}
            request={isPickingNew ? { blockId: null } : pickBlockId !== null ? { blockId: pickBlockId } : null}
          />
        </View>
      </ScrollView>
    </PageSheet>
  );
}

/**
 * Authoring and editing screen for multi-session training programmes.
 * Renders programme metadata, an ordered list of child sessions with
 * playlist-style reordering handles, and atomic transactional save.
 */
/** A fresh form-local id; ids only need to be unique within the open form. */
const formUid = (kind: string) =>
  `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** `source` again as a new, unsaved child plan: fresh ids, no provenance. */
const duplicateChildPlan = (source: ProgrammeChildPlanForm): ProgrammeChildPlanForm => ({
  ...source,
  id: formUid('plan'),
  sourcePlanId: null,
  title: `${source.title} (Copy)`,
  blocks: source.blocks.map((block) => ({
    ...block,
    id: formUid('block'),
    sourceBlockId: null,
    sets: block.sets.map((set) => ({ ...set, id: formUid('set') })),
  })),
});

/**
 * The programme form's child-session edits. `duplicateSession` and
 * `moveSession` read the rendered `form`, as they did inline: both are driven
 * by a row the user can see, so the list they reorder is the one on screen.
 */
const programmeSessionEdits = (
  form: ProgrammeFormState,
  setForm: React.Dispatch<React.SetStateAction<ProgrammeFormState>>
) => {
  const patchPlans = (plans: ProgrammeChildPlanForm[]) => setForm((current) => ({ ...current, plans }));
  return {
    updateChildPlan: (index: number, patch: Partial<ProgrammeChildPlanForm>) =>
      setForm((current) => ({
        ...current,
        plans: current.plans.map((p, idx) => (idx === index ? { ...p, ...patch } : p)),
      })),
    addSession: () =>
      setForm((current) => ({
        ...current,
        plans: [...current.plans, emptyProgrammeChildPlan(current.plans.length)],
      })),
    duplicateSession: (index: number) => {
      const source = form.plans[index];
      if (!source) return;
      const updated = [...form.plans];
      updated.splice(index + 1, 0, duplicateChildPlan(source));
      patchPlans(updated);
    },
    removeSession: (index: number) =>
      setForm((current) => ({ ...current, plans: current.plans.filter((_, idx) => idx !== index) })),
    moveSession: (index: number, step: -1 | 1) => {
      const targetIndex = index + step;
      if (targetIndex < 0 || targetIndex >= form.plans.length) return;
      const reordered = [...form.plans];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(targetIndex, 0, moved);
      patchPlans(reordered);
    },
  };
};

/** One child session's row in the programme form: its summary and its actions. */
function ProgrammeChildPlanCard({
  plan,
  index,
  total,
  hasError,
  onEdit,
  onMove,
  onDuplicate,
  onRemove,
}: {
  plan: ProgrammeChildPlanForm;
  index: number;
  total: number;
  hasError: boolean;
  onEdit: () => void;
  onMove: (step: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const dateFormat = useDateFormat();
  const blockCount = plan.blocks.length;
  const scheduleSummary = planScheduleLabel(plan.scheduleText, dateFormat);
  const name = plan.title || `Session ${index + 1}`;
  const testID = `programme-form-plan-${index + 1}`;

  return (
    <Card style={[styles.planCard, hasError && styles.planCardError]} testID={testID}>
      <View style={styles.planCardTopRow}>
        <View style={styles.planCardInfo}>
          <Text allowFontScaling={false} numberOfLines={1} style={uiText.bodyStrong}>
            {name}
          </Text>
          <Text allowFontScaling={false} numberOfLines={1} style={uiText.meta}>
            <FigureText>{`${scheduleSummary} · ${blockCount} ${blockCount === 1 ? 'block' : 'blocks'}`}</FigureText>
          </Text>
        </View>

        <View style={styles.reorderControls}>
          <IconButton
            accessibilityLabel={`Move session ${plan.title || index + 1} earlier`}
            disabled={index === 0}
            name="arrow-up"
            onPress={() => onMove(-1)}
            size="sm"
            testID={`${testID}-up`}
          />
          <IconButton
            accessibilityLabel={`Move session ${plan.title || index + 1} later`}
            disabled={index === total - 1}
            name="arrow-down"
            onPress={() => onMove(1)}
            size="sm"
            testID={`${testID}-down`}
          />
        </View>
      </View>

      <View style={styles.planCardActions}>
        <ActionButton
          accessibilityLabel={`Edit exercises in ${name}`}
          label="Edit session"
          onPress={onEdit}
          testID={`${testID}-edit`}
          variant="outline"
        />
        <ActionButton
          accessibilityLabel={`Duplicate session ${plan.title || index + 1}`}
          label="Duplicate"
          onPress={onDuplicate}
          testID={`${testID}-duplicate`}
          variant="text"
        />
        <ActionButton
          accessibilityLabel={`Remove session ${plan.title || index + 1}`}
          label="Remove"
          onPress={onRemove}
          testID={`${testID}-remove`}
          tone="danger"
          variant="text"
        />
      </View>

      {hasError ? (
        <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.danger, styles.planCardErrorText]}>
          Please review errors inside this session.
        </Text>
      ) : null}
    </Card>
  );
}

export function ProgrammeFormScreen({
  initialForm,
  onSave,
  saveLabel,
}: ProgrammeFormScreenProps) {
  const [form, setForm] = useState<ProgrammeFormState>(initialForm);
  const [editingPlanIndex, setEditingPlanIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = programmeFormErrors(form);

  const { updateChildPlan, addSession, duplicateSession, removeSession, moveSession } =
    programmeSessionEdits(form, setForm);

  const handleSave = async () => {
    if (busy) return;
    if (errors.size > 0) {
      const firstError = errors.values().next().value;
      setNotice(firstError ?? 'Please resolve form errors before saving.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await onSave(form);
      if (result.status === 'failed') {
        setNotice(result.message ?? "Couldn't save the programme. Try again.");
      }
    } catch {
      setNotice("Couldn't save the programme. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const hasChildPlanError = (index: number): boolean => {
    for (const key of errors.keys()) {
      if (key.startsWith(`plans.${index}`)) return true;
    }
    return false;
  };

  return (
    <View style={styles.container} testID="programme-form-screen">
      {notice ? (
        <Notice
          message={notice}
          testID="programme-form-notice"
          tone="danger"
        />
      ) : null}

      <Card style={styles.sectionCard}>
        <FormField
          accessibilityLabel="Programme name"
          error={errors.get('name')}
          label="Programme name"
          onChangeText={(text) => setForm((c) => ({ ...c, name: text }))}
          placeholder="e.g. 6-week wave, Upper/Lower split"
          testID="programme-form-name"
          value={form.name}
        />

        <FormField
          accessibilityLabel="Programme description"
          error={errors.get('description')}
          label="Description (optional)"
          multiline
          onChangeText={(text) => setForm((c) => ({ ...c, description: text }))}
          placeholder="Progression notes, frequency, wave structure"
          testID="programme-form-description"
          value={form.description}
        />
      </Card>

      <View style={styles.sessionsHeader}>
        <View style={styles.sessionsHeaderTitle}>
          <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, uiTextTone.faint]}>
            <FigureText>{`Sessions (${form.plans.length})`}</FigureText>
          </Text>
        </View>
        <ActionButton
          accessibilityLabel="Add session to programme"
          label="+ Add session"
          onPress={addSession}
          testID="programme-form-add-session"
          variant="outline"
        />
      </View>

      {errors.get('plans') ? (
        <Notice
          message={errors.get('plans')!}
          testID="programme-form-plans-error"
          tone="danger"
        />
      ) : null}

      <View style={styles.plansList}>
        {form.plans.map((plan, index) => (
          <ProgrammeChildPlanCard
            hasError={hasChildPlanError(index)}
            index={index}
            key={plan.id}
            onDuplicate={() => duplicateSession(index)}
            onEdit={() => setEditingPlanIndex(index)}
            onMove={(step) => moveSession(index, step)}
            onRemove={() => removeSession(index)}
            plan={plan}
            total={form.plans.length}
          />
        ))}
      </View>

      <View style={styles.saveSection}>
        <ActionButton
          accessibilityLabel={saveLabel}
          disabled={busy}
          label={busy ? 'Saving...' : saveLabel}
          onPress={handleSave}
          testID="programme-form-save"
          variant="primary"
        />
      </View>

      <ProgrammeSessionEditSheet
        errors={errors}
        onDismiss={() => setEditingPlanIndex(null)}
        onUpdatePlan={updateChildPlan}
        plan={editingPlanIndex !== null ? form.plans[editingPlanIndex] : null}
        planIndex={editingPlanIndex}
        visible={editingPlanIndex !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.md,
    paddingVertical: uiSpace.md,
  },
  sectionCard: {
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  sessionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: uiSpace.xs,
  },
  sessionsHeaderTitle: {
    flex: 1,
  },
  plansList: {
    gap: uiSpace.sm,
  },
  planCard: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  planCardError: {
    borderColor: uiRoles.danger,
    borderWidth: 1,
  },
  planCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planCardInfo: {
    flex: 1,
    gap: uiSpace.xs,
  },
  reorderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  planCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingTop: uiSpace.xs,
  },
  planCardErrorText: {
    marginTop: uiSpace.xs,
  },
  saveSection: {
    paddingTop: uiSpace.md,
  },
  childEditorScroll: {
    flex: 1,
  },
  hidden: {
    display: 'none',
  },
  childEditorBody: {
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
  },
  fieldBlock: {
    gap: uiSpace.xs,
  },
  blocksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
