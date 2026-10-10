import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, FormField, ListRow, Notice, Sheet, StatePanel, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import { PlanBlockEditor } from '@/components/session-planner/plan-block-editor';
import { PlanExercisePickSheet, type PlanExercisePick } from '@/components/session-planner/plan-exercise-pick-sheet';
import {
  emptyPlanFormBlock,
  emptyPlanFormSet,
  planFormErrors,
  type PlanFormBlock,
  type PlanFormSet,
  type PlanFormState,
} from '@/src/session-planner/plan-form-model';
import { upsertLocalGym } from '@/src/data';
import { listSessionGymOptions, type SessionGymOption } from '@/src/session-recorder/gym-options';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';

export type PlanFormScreenProps = {
  /** The editor's starting values: empty for create, a plan's values for edit/duplicate. */
  initialForm: PlanFormState;
  /** The screen's one primary, owned by the host (create vs update). */
  onSave: (form: PlanFormState) => Promise<SaveOutcome>;
  saveLabel: string;
};

export type SaveOutcome =
  | { status: 'saved'; planId: string | null }
  | { status: 'failed'; message: string | null };

export function PlanGymSheet({
  gyms,
  visible,
  onDismiss,
  onPick,
}: {
  gyms: SessionGymOption[] | null;
  visible: boolean;
  onDismiss: () => void;
  onPick: (gymId: string | null) => void;
}) {
  // A seeded gym is written to the local `gyms` table first, as the recorder's
  // `setSessionGym` does, so the plan's `gym_id` always names a local row.
  const pickGym = (gym: SessionGymOption) => {
    void upsertLocalGym({ id: gym.id, name: gym.name }).then(() => onPick(gym.id));
  };
  return (
    <Sheet
      dismissLabel="Dismiss gym picker"
      onDismiss={onDismiss}
      testID="plan-form-gym-sheet"
      title="Plan gym"
      visible={visible}>
      {gyms === null ? (
        <StatePanel body="Loading gyms..." fill={false} kind="loading" />
      ) : (
        <Card>
          <ListRow
            accessibilityLabel="Plan the session with no gym"
            density="list"
            divider={gyms.length > 0}
            label="No gym"
            onPress={() => onPick(null)}
            testID="plan-form-gym-none"
          />
          {gyms.map((gym, index) => (
            <ListRow
              accessibilityLabel={`Plan the session at ${gym.name}`}
              density="list"
              divider={index < gyms.length - 1}
              key={gym.id}
              label={gym.name}
              onPress={() => pickGym(gym)}
              testID={`plan-form-gym-${gym.id}`}
            />
          ))}
        </Card>
      )}
    </Sheet>
  );
}

/**
 * The plan authoring editor shared by create, edit and duplicate: title,
 * optional schedule and gym, ordered exercise blocks with their ordered
 * target sets, and inline field-addressable validation. The host owns the
 * write — this screen never touches the repository.
 */
export function PlanFormScreen({ initialForm, onSave, saveLabel }: PlanFormScreenProps) {
  const [form, setForm] = useState<PlanFormState>(initialForm);
  const [submitted, setSubmitted] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gymSheetOpen, setGymSheetOpen] = useState(false);
  const [gyms, setGyms] = useState<SessionGymOption[] | null>(null);
  const [pickRequest, setPickRequest] = useState<{ blockId: string } | null>(null);
  const { values: trainingPreferences } = useAccountLocalPreferenceState();

  const errors = submitted ? planFormErrors(form) : new Map<string, string>();

  const patchForm = (patch: Partial<PlanFormState>) => setForm((current) => ({ ...current, ...patch }));
  const patchBlock = (blockId: string, patch: Partial<PlanFormBlock>) =>
    setForm((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
    }));
  const patchSet = (blockId: string, setId: string, patch: Partial<PlanFormSet>) =>
    setForm((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId
          ? { ...block, sets: block.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)) }
          : block,
      ),
    }));

  const addBlock = () =>
    setForm((current) => ({ ...current, blocks: [...current.blocks, emptyPlanFormBlock()] }));
  const removeBlock = (blockId: string) =>
    setForm((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== blockId) }));
  const addSet = (blockId: string) =>
    setForm((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, sets: [...block.sets, emptyPlanFormSet()] } : block,
      ),
    }));
  const removeSet = (blockId: string, setId: string) =>
    setForm((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        block.id === blockId ? { ...block, sets: block.sets.filter((set) => set.id !== setId) } : block,
      ),
    }));
  const moveBlock = (blockId: string, step: -1 | 1) =>
    setForm((current) => {
      const fromIndex = current.blocks.findIndex((block) => block.id === blockId);
      const toIndex = fromIndex + step;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= current.blocks.length) return current;
      const blocks = [...current.blocks];
      const [moved] = blocks.splice(fromIndex, 1);
      blocks.splice(toIndex, 0, moved);
      return { ...current, blocks };
    });

  const openGymSheet = async () => {
    setGymSheetOpen(true);
    if (gyms === null) {
      try {
        setGyms(await listSessionGymOptions());
      } catch {
        setGyms([]);
      }
    }
  };

  const save = async () => {
    setSubmitted(true);
    if (saving || planFormErrors(form).size > 0) {
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    try {
      const outcome = await onSave(form);
      if (outcome.status !== 'saved') {
        setSaveNotice(outcome.message ?? "Couldn't save the plan. Try again.");
      }
    } catch {
      setSaveNotice("Couldn't save the plan. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <FormField
          accessibilityLabel="Plan title"
          autoCapitalize="sentences"
          error={errors.get('title')}
          label="Title"
          onChangeText={(title) => patchForm({ title })}
          placeholder="e.g. Heavy squat day"
          testID="plan-form-title"
          value={form.title}
        />
        <FormField
          accessibilityHint="YYYY-MM-DD HH:mm, or leave blank to keep the plan unscheduled"
          accessibilityLabel="Plan schedule"
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.get('scheduledFor')}
          keyboardType="numbers-and-punctuation"
          label="Schedule (optional)"
          onChangeText={(scheduleText) => patchForm({ scheduleText })}
          placeholder="YYYY-MM-DD HH:mm"
          testID="plan-form-schedule"
          value={form.scheduleText}
        />
        <ListRow
          accessibilityLabel={`Plan gym, ${form.gymId === null ? 'none' : 'selected'}`}
          density="list"
          divider
          description={form.gymId === null ? 'None' : gyms?.find((gym) => gym.id === form.gymId)?.name ?? 'Selected'}
          label="Gym (optional)"
          onPress={() => void openGymSheet()}
          testID="plan-form-gym"
        />
        {form.blocks.map((block, index) => (
          <PlanBlockEditor
            block={block}
            count={form.blocks.length}
            errors={errors}
            index={index}
            key={block.id}
            onAddSet={addSet}
            onChangeBlock={patchBlock}
            onChangeSet={patchSet}
            onMoveBlock={moveBlock}
            displayEfforts={trainingPreferences.displayEfforts}
            onPickExercise={(blockId) => setPickRequest({ blockId })}
            onRemoveBlock={removeBlock}
            onRemoveSet={removeSet}
          />
        ))}
        <ListRow
          accessibilityLabel="Add exercise block to the plan"
          density="list"
          divider
          label="Add exercise"
          onPress={() => addBlock()}
          testID="plan-form-add-block"
        />
        {errors.get('exercises') ? (
          <Text allowFontScaling={false} style={styles.error} testID="plan-form-blocks-error">
            {errors.get('exercises')}
          </Text>
        ) : null}
        {form.blocks.length === 0 ? (
          <Text allowFontScaling={false} style={styles.hint} testID="plan-form-blocks-empty">
            A plan needs at least one exercise.
          </Text>
        ) : null}
        {saveNotice ? <Notice message={saveNotice} testID="plan-form-notice" tone="danger" /> : null}
        <ActionButton
          accessibilityLabel={saveLabel}
          disabled={saving}
          label={saveLabel}
          onPress={() => void save()}
          testID="plan-form-save"
          variant="primary"
        />
      </View>

      <PlanGymSheet
        gyms={gyms}
        onDismiss={() => setGymSheetOpen(false)}
        onPick={(gymId) => {
          setGymSheetOpen(false);
          patchForm({ gymId });
        }}
        visible={gymSheetOpen}
      />

      <PlanExercisePickSheet
        onDismiss={() => setPickRequest(null)}
        onPick={(blockId, pick: PlanExercisePick) =>
          patchBlock(blockId, {
            exerciseDefinitionId: pick.id,
            name: pick.name,
            loadInputMode: pick.loadInputMode,
          })
        }
        request={pickRequest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    gap: uiSpace.md,
    padding: uiSpace.lg,
  },
  hint: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  error: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
});
