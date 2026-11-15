import { useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { ChoiceRow, FormError, FormSection } from '@/components/ui/form-section';
import { FormField } from '@/components/ui/form-field';
import { ListRow } from '@/components/ui/list-row';
import { PageSheet } from '@/components/ui/page-sheet';
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SliderRow } from '@/components/ui/slider-row';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiSpace } from '@/components/ui/tokens';
import {
  InjuryInputError,
  removeInjury,
  saveInjury,
  updateInjuryStatus,
  type InjuryInput,
  type InjurySide,
  type InjuryStatus,
  type InjuryView,
} from '@/src/data/injuries';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { resolveAnatomyAlias } from '@/src/injuries/anatomy-aliases';
import {
  describePainScore,
  formatInjuryAnatomy,
  formatPainSlider,
} from '@/src/injuries/injury-presentation';

export type InjuryEditorSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  onSaved?: (saved: InjuryView) => void;
  injury?: InjuryView | null;
  initialMuscleGroupId?: string | null;
  initialSide?: InjurySide | null;
  initialLabel?: string;
  testID?: string;
};

const SIDE_OPTIONS: readonly SegmentedControlOption<InjurySide | 'none'>[] = [
  { value: 'left', label: 'Left' },
  { value: 'bilateral', label: 'Bilateral' },
  { value: 'right', label: 'Right' },
  { value: 'none', label: 'None' },
];

const STATUS_OPTIONS: readonly SegmentedControlOption<InjuryStatus>[] = [
  { value: 'acute', label: 'Acute' },
  { value: 'managing', label: 'Managing' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
];

export function InjuryEditorSheet({
  visible,
  onDismiss,
  onSaved,
  injury,
  initialMuscleGroupId,
  initialSide,
  initialLabel,
  testID = 'injury-editor-sheet',
}: InjuryEditorSheetProps) {
  return (
    <PageSheet
      closeLabel="Close injury editor"
      keyboardAvoiding
      onDismiss={onDismiss}
      testID={testID}
      title={injury ? 'Edit injury' : 'Log injury'}
      visible={visible}>
      {visible ? (
        <InjuryEditorContent
          initialLabel={initialLabel}
          initialMuscleGroupId={initialMuscleGroupId}
          initialSide={initialSide}
          injury={injury}
          key={injury?.id ?? `new-${initialMuscleGroupId ?? ''}-${initialLabel ?? ''}`}
          onDismiss={onDismiss}
          onSaved={onSaved}
        />
      ) : null}
    </PageSheet>
  );
}

type ContentProps = {
  injury?: InjuryView | null;
  initialMuscleGroupId?: string | null;
  initialSide?: InjurySide | null;
  initialLabel?: string;
  onDismiss: () => void;
  onSaved?: (saved: InjuryView) => void;
};

type PainLifecycleSectionProps = {
  painScore: number;
  onPainScoreChange: (score: number) => void;
  status: InjuryStatus;
  onStatusChange: (status: InjuryStatus) => void;
  styles: ReturnType<typeof useStyles>;
};

function PainLifecycleSection({
  painScore,
  onPainScoreChange,
  status,
  onStatusChange,
  styles,
}: PainLifecycleSectionProps) {
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  const painDescription = describePainScore(painScore);

  return (
    <FormSection title="Pain & Lifecycle">
      <SliderRow
        divider
        format={formatPainSlider}
        label="Pain rating"
        max={10}
        min={0}
        onChange={onPainScoreChange}
        onChangeEnd={onPainScoreChange}
        step={1}
        testID="injury-form-pain-slider"
        value={painScore}
      />
      <View style={styles.painBandRow}>
        <Text
          allowFontScaling={false}
          style={[textRoles.meta, textTones[painDescription.colorRole]]}
          testID="injury-form-pain-band">
          {painDescription.bandLabel}
        </Text>
      </View>
      <View style={styles.sectionRow}>
        <Text allowFontScaling={false} style={textRoles.label}>
          Status
        </Text>
        <SegmentedControl
          accessibilityLabel="Status selector"
          onChange={onStatusChange}
          options={STATUS_OPTIONS}
          testIDPrefix="injury-form-status"
          value={status}
        />
      </View>
    </FormSection>
  );
}

type EditorActionsProps = {
  isEditing: boolean;
  isResolved: boolean;
  isSubmitting: boolean;
  onSave: () => void;
  onResolve: () => void;
  onDelete: () => void;
  styles: ReturnType<typeof useStyles>;
};

function EditorActions({
  isEditing,
  isResolved,
  isSubmitting,
  onSave,
  onResolve,
  onDelete,
  styles,
}: EditorActionsProps) {
  return (
    <View style={styles.actions}>
      <ActionButton
        accessibilityLabel="Save injury"
        disabled={isSubmitting}
        label={isEditing ? 'Update injury' : 'Save injury'}
        onPress={onSave}
        testID="injury-form-save-button"
        variant="primary"
      />
      {isEditing && !isResolved ? (
        <ActionButton
          accessibilityLabel="Mark injury as resolved"
          disabled={isSubmitting}
          label="Mark as resolved"
          onPress={onResolve}
          testID="injury-form-resolve-button"
          variant="outline"
        />
      ) : null}
      {isEditing ? (
        <ActionButton
          accessibilityLabel="Delete injury"
          disabled={isSubmitting}
          label="Remove injury"
          onPress={onDelete}
          testID="injury-form-delete-button"
          tone="danger"
          variant="text"
        />
      ) : null}
    </View>
  );
}

type MusclePickerSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  muscleGroupId: string | null;
  onSelect: (id: string | null) => void;
};

function MusclePickerSheet({
  visible,
  onDismiss,
  muscleGroupId,
  onSelect,
}: MusclePickerSheetProps) {
  const catalog = useExerciseCatalog();

  return (
    <Sheet
      dismissLabel="Dismiss muscle picker"
      onDismiss={onDismiss}
      testID="injury-muscle-picker-sheet"
      title="Select Muscle"
      visible={visible}>
      <ListRow
        key="none"
        label="None / Unmapped anatomy"
        onPress={() => {
          onSelect(null);
          onDismiss();
        }}
        selected={muscleGroupId === null}
        testID="injury-muscle-option-none"
      />
      {catalog.muscleGroups.map((mg) => (
        <ListRow
          key={mg.id}
          label={mg.displayName}
          onPress={() => {
            onSelect(mg.id);
            onDismiss();
          }}
          selected={mg.id === muscleGroupId}
          testID={`injury-muscle-option-${mg.id}`}
        />
      ))}
    </Sheet>
  );
}

function InjuryEditorContent({
  injury,
  initialMuscleGroupId,
  initialSide,
  initialLabel,
  onDismiss,
  onSaved,
}: ContentProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const catalog = useExerciseCatalog();

  const [label, setLabel] = useState(injury?.label ?? initialLabel ?? '');
  const [muscleGroupId, setMuscleGroupId] = useState<string | null>(
    injury?.muscleGroupId ?? initialMuscleGroupId ?? null
  );
  const [side, setSide] = useState<InjurySide | null>(injury?.side ?? initialSide ?? null);
  const [status, setStatus] = useState<InjuryStatus>(injury?.status ?? 'acute');
  const [painScore, setPainScore] = useState<number>(injury?.painScore ?? 5);
  const [notes, setNotes] = useState(injury?.notes ?? '');
  const [contraindications, setContraindications] = useState(injury?.contraindications ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [musclePickerVisible, setMusclePickerVisible] = useState(false);

  const handleLabelChange = (text: string) => {
    setLabel(text);
    if (!injury && !muscleGroupId) {
      const aliasMatch = resolveAnatomyAlias(text);
      if (aliasMatch && catalog.muscleGroupsById[aliasMatch]) {
        setMuscleGroupId(aliasMatch);
      }
    }
  };

  const selectedMuscle = muscleGroupId ? catalog.muscleGroupsById[muscleGroupId] : null;

  const handleSave = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const input: InjuryInput = {
      id: injury?.id,
      label,
      muscleGroupId,
      side,
      status,
      painScore,
      notes: notes.trim() ? notes : null,
      contraindications: contraindications.trim() ? contraindications : null,
    };

    try {
      const saved = await saveInjury(input);
      onSaved?.(saved);
      onDismiss();
    } catch (err) {
      setErrorMessage(
        err instanceof InjuryInputError ? err.message : 'Could not save injury. Try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolve = async () => {
    if (!injury) return;
    setIsSubmitting(true);
    try {
      const resolved = await updateInjuryStatus(injury.id, 'resolved');
      onSaved?.(resolved);
      onDismiss();
    } catch {
      setErrorMessage('Could not resolve injury. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    if (!injury) return;
    Alert.alert('Remove injury?', 'This injury will be removed from your profile.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setIsSubmitting(true);
          try {
            await removeInjury(injury.id);
            onDismiss();
          } catch {
            setErrorMessage('Could not remove injury. Try again.');
          } finally {
            setIsSubmitting(false);
          }
        },
      },
    ]);
  };

  const anatomySummary = formatInjuryAnatomy(selectedMuscle?.displayName ?? null, side);

  return (
    <View style={styles.content}>
      {errorMessage ? (
        <View style={styles.errorContainer}>
          <FormError message={errorMessage} testID="injury-form-error" />
        </View>
      ) : null}

      <FormSection title="Details">
        <FormField
          autoFocus={!injury}
          label="Injury or discomfort"
          onChangeText={handleLabelChange}
          placeholder="e.g. Patellar tendon irritation"
          testID="injury-form-label"
          value={label}
        />
        <ChoiceRow
          accessibilityLabel={`Target anatomy, ${anatomySummary}`}
          divider
          label="Anatomy"
          onPress={() => setMusclePickerVisible(true)}
          testID="injury-form-muscle-choice"
          value={selectedMuscle?.displayName ?? 'Unlinked / None'}
        />
        <View style={styles.sectionRow}>
          <Text allowFontScaling={false} style={textRoles.label}>
            Side
          </Text>
          <SegmentedControl
            accessibilityLabel="Side selector"
            onChange={(val) => setSide(val === 'none' ? null : val)}
            options={SIDE_OPTIONS}
            testIDPrefix="injury-form-side"
            value={side ?? 'none'}
          />
        </View>
      </FormSection>

      <PainLifecycleSection
        onPainScoreChange={setPainScore}
        onStatusChange={setStatus}
        painScore={painScore}
        status={status}
        styles={styles}
      />

      <FormSection title="Notes & Limitations">
        <FormField
          label="Notes"
          multiline
          numberOfLines={3}
          onChangeText={setNotes}
          placeholder="Flare-up triggers, sensations, notes..."
          testID="injury-form-notes"
          value={notes}
        />
        <FormField
          label="Contraindications"
          onChangeText={setContraindications}
          placeholder="Movements to avoid (e.g. deep squats)"
          testID="injury-form-contraindications"
          value={contraindications}
        />
      </FormSection>

      <EditorActions
        isEditing={Boolean(injury)}
        isResolved={injury?.status === 'resolved'}
        isSubmitting={isSubmitting}
        onDelete={handleDelete}
        onResolve={handleResolve}
        onSave={handleSave}
        styles={styles}
      />

      <MusclePickerSheet
        muscleGroupId={muscleGroupId}
        onDismiss={() => setMusclePickerVisible(false)}
        onSelect={setMuscleGroupId}
        visible={musclePickerVisible}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  content: {
    paddingBottom: uiSpace.xl,
  },
  errorContainer: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
  },
  sectionRow: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  painBandRow: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  actions: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.lg,
    gap: uiSpace.sm,
  },
}));
