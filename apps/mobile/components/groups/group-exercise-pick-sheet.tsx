import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon, UiButton, UiText, uiBorder, uiColors, uiRadius, uiSpace } from '@/components/ui';
import {
  buildPickSheetModel,
  describeLinkRetroactivity,
  describeLoadModeNote,
  filterPickSheetChoices,
  type GroupExercise,
  type LinkRef,
  type LinkableExercise,
} from '@/src/groups';

import { groupFormStyles } from './screen-styles';

export type GroupExercisePickTarget = {
  groupId: string;
  groupName: string;
  groupExercise: GroupExercise;
  /** `link`: no linked exercise yet (E0.2). `choose-linked`: several of mine are linked; pick one to add. */
  mode: 'link' | 'choose-linked';
  linkedExercises: LinkableExercise[];
};

type Option = { kind: 'suggested' } | { kind: 'other'; exerciseId: string | null } | { kind: 'add-new' };

type GroupExercisePickSheetProps = {
  target: GroupExercisePickTarget | null;
  exercises: LinkableExercise[];
  links: LinkRef[];
  onRequestClose: () => void;
  /** Links, then (unless `link-only`) adds; a rejection shows inline and nothing is added. */
  onLinkAndAdd: (exercise: LinkableExercise) => Promise<void>;
  /** Opens the prefilled editor for "Add as new". */
  onAddAsNew: () => void;
} & (
  | {
      /** The recorder (default): the confirm reads `Link and add`. */
      purpose?: 'add-to-session';
      /** Adds an already linked exercise (`choose-linked`). */
      onAddExercise: (exercise: LinkableExercise) => void;
    }
  | {
      /** The group page: the confirm reads `Link`; its targets are always `mode: 'link'`. */
      purpose: 'link-only';
      onAddExercise?: never;
    }
);

/**
 * The pick sheet (M25-T07; product E0.2): picking an unlinked group exercise
 * while logging asks which of my exercises it is — the suggestion, another of
 * my live exercises, or a new one — then links (a local write, so it works
 * offline) and adds my exercise to the session. An in-route `Modal`.
 *
 * `purpose="link-only"` (M25-T08; product E0.4, the group page's "Link your
 * exercise") confirms with `Link`: the caller only links, and nothing is added
 * to a session. The target is always `mode: 'link'` there.
 */
export function GroupExercisePickSheet(props: GroupExercisePickSheetProps) {
  const { target, exercises, links, onRequestClose, onLinkAndAdd, onAddAsNew } = props;
  const purpose = props.purpose ?? 'add-to-session';
  const model = useMemo(
    () =>
      target && target.mode === 'link'
        ? buildPickSheetModel({
            groupId: target.groupId,
            groupName: target.groupName,
            groupExercise: target.groupExercise,
            exercises,
            links,
          })
        : null,
    [exercises, links, target],
  );
  const [option, setOption] = useState<Option>({ kind: 'add-new' });
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset whenever a new target opens: the suggestion is preselected, else "Add as new".
  useEffect(() => {
    setOption(model?.defaultOption === 'suggested' ? { kind: 'suggested' } : { kind: 'add-new' });
    setSearch('');
    setPending(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new target resets the choice, not a links reload
  }, [target]);

  if (!target) {
    return null;
  }

  const chosen: LinkableExercise | null =
    option.kind === 'suggested'
      ? model?.suggestion ?? null
      : option.kind === 'other'
        ? exercises.find((exercise) => exercise.id === option.exerciseId) ?? null
        : null;
  const loadModeNote = chosen ? describeLoadModeNote(chosen.loadInputMode, target.groupExercise.load_input_mode) : null;
  const title = `${target.groupExercise.name} · ${target.groupName}`;

  const confirm = async () => {
    if (option.kind === 'add-new') {
      onAddAsNew();
      return;
    }
    if (!chosen) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onLinkAndAdd(chosen);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't link this exercise.");
      setPending(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onRequestClose} transparent visible>
      <View style={styles.root}>
        <Pressable accessibilityLabel="Dismiss group exercise pick sheet" onPress={onRequestClose} style={styles.scrim} />
        <View style={styles.card} testID="group-pick-sheet">
          <UiText accessibilityRole="header" numberOfLines={2} variant="title">
            {title}
          </UiText>
          {target.mode === 'choose-linked' ? (
            <>
              <UiText variant="bodyMuted">Which of your linked exercises?</UiText>
              <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
                {target.linkedExercises.map((exercise) => (
                  <UiButton
                    key={exercise.id}
                    label={exercise.name}
                    onPress={() => {
                      if (props.purpose !== 'link-only') props.onAddExercise(exercise);
                    }}
                    testID={`group-pick-sheet-linked-${exercise.id}`}
                    variant="secondary"
                  />
                ))}
              </ScrollView>
            </>
          ) : (
            <>
              <UiText variant="bodyMuted">Which of your exercises is this?</UiText>
              <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
                {model?.suggestion ? (
                  <RadioRow
                    checked={option.kind === 'suggested'}
                    detail="your exercise · suggested"
                    label={model.suggestion.name}
                    onPress={() => setOption({ kind: 'suggested' })}
                    testID="group-pick-sheet-option-suggested"
                  />
                ) : null}
                <RadioRow
                  checked={option.kind === 'other'}
                  label="Choose another of your exercises…"
                  onPress={() => setOption({ kind: 'other', exerciseId: null })}
                  testID="group-pick-sheet-option-other"
                />
                {option.kind === 'other' && model ? (
                  <View style={styles.otherList}>
                    <TextInput
                      accessibilityLabel="Search your exercises"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={setSearch}
                      placeholder="Search your exercises"
                      style={groupFormStyles.input}
                      testID="group-pick-sheet-search"
                      value={search}
                    />
                    {filterPickSheetChoices(model.choices, search).map(({ exercise, unavailableReason }) => (
                      <Pressable
                        accessibilityLabel={
                          unavailableReason ? `${exercise.name}, ${unavailableReason}` : `Choose ${exercise.name}`
                        }
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: option.exerciseId === exercise.id,
                          disabled: unavailableReason !== null,
                        }}
                        disabled={unavailableReason !== null}
                        key={exercise.id}
                        onPress={() => setOption({ kind: 'other', exerciseId: exercise.id })}
                        style={[styles.choice, option.exerciseId === exercise.id ? styles.choiceSelected : null]}
                        testID={`group-pick-sheet-choice-${exercise.id}`}>
                        <UiText style={unavailableReason ? styles.disabledText : undefined}>{exercise.name}</UiText>
                        {unavailableReason ? <UiText variant="bodyMuted">{unavailableReason}</UiText> : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <RadioRow
                  checked={option.kind === 'add-new'}
                  label={`Add "${target.groupExercise.name}" as a new exercise`}
                  onPress={() => setOption({ kind: 'add-new' })}
                  testID="group-pick-sheet-option-add-new"
                />
              </ScrollView>
              {chosen ? (
                <UiText testID="group-pick-sheet-retroactivity" variant="bodyMuted">
                  {describeLinkRetroactivity(chosen.name, target.groupName)}
                </UiText>
              ) : null}
              {loadModeNote ? (
                <UiText testID="group-pick-sheet-load-mode-note" variant="bodyMuted">
                  {loadModeNote}
                </UiText>
              ) : null}
              {error ? (
                <UiText accessibilityRole="alert" style={styles.error} testID="group-pick-sheet-error">
                  {error}
                </UiText>
              ) : null}
              <UiButton
                disabled={pending || (option.kind !== 'add-new' && !chosen)}
                label={option.kind === 'add-new' ? 'Create exercise…' : purpose === 'link-only' ? 'Link' : 'Link and add'}
                onPress={() => void confirm()}
                testID="group-pick-sheet-confirm"
              />
            </>
          )}
          <UiButton label="Cancel" onPress={onRequestClose} testID="group-pick-sheet-cancel" variant="secondary" />
        </View>
      </View>
    </Modal>
  );
}

function RadioRow({
  checked,
  label,
  detail,
  onPress,
  testID,
}: {
  checked: boolean;
  label: string;
  detail?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.choice, checked ? styles.choiceSelected : null]}
      testID={testID}>
      <View style={styles.choiceRow}>
        <Icon
          color={checked ? uiColors.actionPrimary : uiColors.textSecondary}
          name={checked ? 'radio-on' : 'radio-off'}
          size="sm"
        />
        <View style={styles.choiceCopy}>
          <UiText>{label}</UiText>
          {detail ? <UiText variant="bodyMuted">{detail}</UiText> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: uiColors.overlayScrim,
  },
  card: {
    maxHeight: '85%',
    gap: uiSpace.md,
    borderTopLeftRadius: uiRadius.md,
    borderTopRightRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    padding: uiSpace.xl,
  },
  list: {
    gap: uiSpace.sm,
  },
  otherList: {
    gap: uiSpace.xs,
    paddingLeft: uiSpace.md,
  },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  choiceCopy: {
    flex: 1,
  },
  choiceSelected: {
    borderColor: uiColors.rowActiveBorder,
    backgroundColor: uiColors.rowActiveBackground,
  },
  disabledText: {
    color: uiColors.textDisabled,
  },
  error: {
    color: uiColors.actionDangerText,
  },
});
