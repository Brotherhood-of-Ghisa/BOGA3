import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  FormField,
  IconButton,
  ListRow,
  Notice,
  Sheet,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { PlanBlockEditor } from '@/components/session-planner/plan-block-editor';
import { PlanExercisePickSheet, type PlanExercisePick } from '@/components/session-planner/plan-exercise-pick-sheet';
import { PlanGymSheet, type SaveOutcome } from '@/components/session-planner/plan-form-screen';
import {
  emptyProgrammeChildPlan,
  emptyPlanFormBlock,
  emptyPlanFormSet,
  programmeFormErrors,
  type ProgrammeChildPlanForm,
  type ProgrammeFormState,
} from '@/src/session-planner';
import type { PlanFormBlock, PlanFormSet } from '@/src/session-planner/plan-form-model';
import { listSessionGymOptions, type SessionGymOption } from '@/src/session-recorder/gym-options';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';

export type ProgrammeFormScreenProps = {
  initialForm: ProgrammeFormState;
  onSave: (form: ProgrammeFormState) => Promise<SaveOutcome>;
  saveLabel: string;
};

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
}: {
  plan: ProgrammeChildPlanForm | null;
  planIndex: number | null;
  visible: boolean;
  errors: Map<string, string>;
  onDismiss: () => void;
  onUpdatePlan: (index: number, patch: Partial<ProgrammeChildPlanForm>) => void;
}) {
  const [gyms, setGyms] = useState<SessionGymOption[] | null>(null);
  const [gymSheetVisible, setGymSheetVisible] = useState(false);
  const [pickBlockId, setPickBlockId] = useState<string | null>(null);
  const { values: trainingPreferences } = useAccountLocalPreferenceState();

  if (!plan || planIndex === null) {
    return null;
  }

  const prefix = `plans.${planIndex}`;

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

  const updateBlock = (blockId: string, patch: Partial<PlanFormBlock>) => {
    onUpdatePlan(planIndex, {
      blocks: plan.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
    });
  };

  const updateSet = (blockId: string, setId: string, patch: Partial<PlanFormSet>) => {
    onUpdatePlan(planIndex, {
      blocks: plan.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              sets: block.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
            }
          : block
      ),
    });
  };

  const addSet = (blockId: string) => {
    onUpdatePlan(planIndex, {
      blocks: plan.blocks.map((block) =>
        block.id === blockId ? { ...block, sets: [...block.sets, emptyPlanFormSet()] } : block
      ),
    });
  };

  const removeSet = (blockId: string, setId: string) => {
    onUpdatePlan(planIndex, {
      blocks: plan.blocks.map((block) =>
        block.id === blockId && block.sets.length > 1
          ? { ...block, sets: block.sets.filter((set) => set.id !== setId) }
          : block
      ),
    });
  };

  const addBlock = () => {
    onUpdatePlan(planIndex, {
      blocks: [...plan.blocks, emptyPlanFormBlock()],
    });
  };

  const removeBlock = (blockId: string) => {
    if (plan.blocks.length <= 1) return;
    onUpdatePlan(planIndex, {
      blocks: plan.blocks.filter((b) => b.id !== blockId),
    });
  };

  const moveBlock = (blockId: string, step: -1 | 1) => {
    const fromIndex = plan.blocks.findIndex((b) => b.id === blockId);
    const toIndex = fromIndex + step;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= plan.blocks.length) return;
    const reordered = [...plan.blocks];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onUpdatePlan(planIndex, { blocks: reordered });
  };

  const onPickExercise = (blockId: string, pick: PlanExercisePick) => {
    updateBlock(blockId, {
      exerciseDefinitionId: pick.id,
      name: pick.name,
      loadInputMode: pick.loadInputMode,
    });
    setPickBlockId(null);
  };

  return (
    <Sheet
      dismissLabel="Close session editor"
      onDismiss={onDismiss}
      testID="programme-child-plan-editor-sheet"
      title={`Edit ${plan.title || 'Session'}`}
      visible={visible}>
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

        <FormField
          accessibilityLabel="Schedule date and time"
          error={errors.get(`${prefix}.scheduledFor`)}
          hint="Leave blank for an unscheduled session."
          label="Schedule (optional)"
          onChangeText={(text) => onUpdatePlan(planIndex, { scheduleText: text })}
          placeholder="YYYY-MM-DD HH:mm"
          testID="programme-child-plan-schedule-input"
          value={plan.scheduleText}
        />

        <View style={styles.fieldBlock}>
          <Text allowFontScaling={false} style={styles.fieldLabel}>
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

        <View style={styles.fieldBlock}>
          <View style={styles.blocksHeader}>
            <Text allowFontScaling={false} accessibilityRole="header" style={styles.fieldLabel}>
              Exercise blocks
            </Text>
            <ActionButton
              accessibilityLabel="Add exercise block"
              label="+ Add exercise"
              onPress={addBlock}
              testID="programme-child-plan-add-block"
              variant="outline"
            />
          </View>

          {plan.blocks.map((block, blockIdx) => (
            <PlanBlockEditor
              block={block}
              count={plan.blocks.length}
              displayEfforts={trainingPreferences.displayEfforts}
              errorPrefix={`${prefix}.exercises`}
              errors={errors}
              index={blockIdx}
              key={block.id}
              onAddSet={addSet}
              onChangeBlock={updateBlock}
              onChangeSet={updateSet}
              onMoveBlock={moveBlock}
              onPickExercise={(id) => setPickBlockId(id)}
              onRemoveBlock={removeBlock}
              onRemoveSet={removeSet}
            />
          ))}
        </View>

        <ActionButton
          accessibilityLabel="Done editing session"
          label="Done"
          onPress={onDismiss}
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

        <PlanExercisePickSheet
          onDismiss={() => setPickBlockId(null)}
          onPick={onPickExercise}
          request={pickBlockId !== null ? { blockId: pickBlockId } : null}
        />
      </View>
    </Sheet>
  );
}

/**
 * Authoring and editing screen for multi-session training programmes.
 * Renders programme metadata, an ordered list of child sessions with
 * playlist-style reordering handles, and atomic transactional save.
 */
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

  const updateChildPlan = (index: number, patch: Partial<ProgrammeChildPlanForm>) => {
    setForm((current) => ({
      ...current,
      plans: current.plans.map((p, idx) => (idx === index ? { ...p, ...patch } : p)),
    }));
  };

  const addSession = () => {
    setForm((current) => ({
      ...current,
      plans: [...current.plans, emptyProgrammeChildPlan(current.plans.length)],
    }));
  };

  const duplicateSession = (index: number) => {
    const source = form.plans[index];
    if (!source) return;
    const duplicated: ProgrammeChildPlanForm = {
      ...source,
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sourcePlanId: null,
      title: `${source.title} (Copy)`,
      blocks: source.blocks.map((block) => ({
        ...block,
        id: `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        sourceBlockId: null,
        sets: block.sets.map((set) => ({
          ...set,
          id: `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        })),
      })),
    };
    const updated = [...form.plans];
    updated.splice(index + 1, 0, duplicated);
    setForm((current) => ({ ...current, plans: updated }));
  };

  const removeSession = (index: number) => {
    setForm((current) => ({
      ...current,
      plans: current.plans.filter((_, idx) => idx !== index),
    }));
  };

  const moveSession = (index: number, step: -1 | 1) => {
    const targetIndex = index + step;
    if (targetIndex < 0 || targetIndex >= form.plans.length) return;
    const reordered = [...form.plans];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setForm((current) => ({ ...current, plans: reordered }));
  };

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
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
            Sessions ({form.plans.length})
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
        {form.plans.map((plan, index) => {
          const blockCount = plan.blocks.length;
          const scheduleSummary = plan.scheduleText.trim().length > 0 ? plan.scheduleText : 'Unscheduled';
          const hasError = hasChildPlanError(index);

          return (
            <Card
              key={plan.id}
              style={[styles.planCard, hasError && styles.planCardError]}
              testID={`programme-form-plan-${index + 1}`}>
              <View style={styles.planCardTopRow}>
                <View style={styles.planCardInfo}>
                  <Text allowFontScaling={false} numberOfLines={1} style={styles.planCardTitle}>
                    {plan.title || `Session ${index + 1}`}
                  </Text>
                  <Text allowFontScaling={false} numberOfLines={1} style={styles.planCardSummary}>
                    {scheduleSummary} · {blockCount} {blockCount === 1 ? 'block' : 'blocks'}
                  </Text>
                </View>

                <View style={styles.reorderControls}>
                  <IconButton
                    accessibilityLabel={`Move session ${plan.title || index + 1} earlier`}
                    disabled={index === 0}
                    name="arrow-up"
                    onPress={() => moveSession(index, -1)}
                    size="sm"
                    testID={`programme-form-plan-${index + 1}-up`}
                  />
                  <IconButton
                    accessibilityLabel={`Move session ${plan.title || index + 1} later`}
                    disabled={index === form.plans.length - 1}
                    name="arrow-down"
                    onPress={() => moveSession(index, 1)}
                    size="sm"
                    testID={`programme-form-plan-${index + 1}-down`}
                  />
                </View>
              </View>

              <View style={styles.planCardActions}>
                <ActionButton
                  accessibilityLabel={`Edit exercises in ${plan.title || `Session ${index + 1}`}`}
                  label="Edit session"
                  onPress={() => setEditingPlanIndex(index)}
                  testID={`programme-form-plan-${index + 1}-edit`}
                  variant="outline"
                />
                <ActionButton
                  accessibilityLabel={`Duplicate session ${plan.title || index + 1}`}
                  label="Duplicate"
                  onPress={() => duplicateSession(index)}
                  testID={`programme-form-plan-${index + 1}-duplicate`}
                  variant="text"
                />
                <ActionButton
                  accessibilityLabel={`Remove session ${plan.title || index + 1}`}
                  label="Remove"
                  onPress={() => removeSession(index)}
                  testID={`programme-form-plan-${index + 1}-remove`}
                  tone="danger"
                  variant="text"
                />
              </View>

              {hasError ? (
                <Text allowFontScaling={false} style={styles.planCardErrorText}>
                  Please review errors inside this session.
                </Text>
              ) : null}
            </Card>
          );
        })}
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
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
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
  planCardTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  planCardSummary: {
    fontFamily: uiFonts.display.family,
    fontWeight: '400',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
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
    fontFamily: uiFonts.display.family,
    fontSize: uiTypography.size.xs,
    color: uiRoles.danger,
    marginTop: uiSpace.xs,
  },
  saveSection: {
    paddingTop: uiSpace.md,
  },
  childEditorBody: {
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
  },
  fieldBlock: {
    gap: uiSpace.xs,
  },
  fieldLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    color: uiRoles.ink,
  },
  blocksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
