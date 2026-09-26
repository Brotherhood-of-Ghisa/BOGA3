import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Icon,
  ListRow,
  Notice,
  SearchField,
  Sheet,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import {
  buildPickSheetModel,
  describeLinkRetroactivity,
  describeLoadModeNote,
  filterPickSheetChoices,
  type GroupExercise,
  type LinkRef,
  type LinkableExercise,
} from '@/src/groups';

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
      /** The exercise picker (default): the confirm reads `Link and add`. */
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
 * offline) and adds my exercise to the session. A `Sheet` with no Cancel
 * (G5): the backdrop dismisses it. Its confirm is the sheet's one `accent`.
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
    <Sheet
      dismissLabel="Dismiss group exercise pick sheet"
      keyboardAvoiding
      onDismiss={onRequestClose}
      testID="group-pick-sheet"
      title={title}
      visible>
      {target.mode === 'choose-linked' ? (
        <>
          <Text allowFontScaling={false} style={[styles.note, styles.prompt]}>Which of your linked exercises?</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
            {target.linkedExercises.map((exercise, index) => (
              <ListRow
                divider={index > 0}
                key={exercise.id}
                label={exercise.name}
                onPress={() => {
                  if (props.purpose !== 'link-only') props.onAddExercise(exercise);
                }}
                testID={`group-pick-sheet-linked-${exercise.id}`}
              />
            ))}
          </ScrollView>
        </>
      ) : (
        <>
          <Text allowFontScaling={false} style={[styles.note, styles.prompt]}>Which of your exercises is this?</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
            {model?.suggestion ? (
              <RadioRow
                checked={option.kind === 'suggested'}
                detail="your exercise · suggested"
                divider={false}
                label={model.suggestion.name}
                onPress={() => setOption({ kind: 'suggested' })}
                testID="group-pick-sheet-option-suggested"
              />
            ) : null}
            <RadioRow
              checked={option.kind === 'other'}
              divider={Boolean(model?.suggestion)}
              label="Choose another of your exercises…"
              onPress={() => setOption({ kind: 'other', exerciseId: null })}
              testID="group-pick-sheet-option-other"
            />
            {option.kind === 'other' && model ? (
              <View style={styles.otherList}>
                <View style={styles.search}>
                  <SearchField
                    accessibilityLabel="Search your exercises"
                    autoCapitalize="none"
                    onChangeText={setSearch}
                    placeholder="Search your exercises"
                    testID="group-pick-sheet-search"
                    value={search}
                  />
                </View>
                {filterPickSheetChoices(model.choices, search).map(({ exercise, unavailableReason }) => (
                  <ListRow
                    accessibilityLabel={
                      unavailableReason ? `${exercise.name}, ${unavailableReason}` : `Choose ${exercise.name}`
                    }
                    checked={option.exerciseId === exercise.id}
                    density="list"
                    disabled={unavailableReason !== null}
                    key={exercise.id}
                    leading={<RadioGlyph checked={option.exerciseId === exercise.id} faint={unavailableReason !== null} />}
                    onPress={() => setOption({ kind: 'other', exerciseId: exercise.id })}
                    testID={`group-pick-sheet-choice-${exercise.id}`}>
                    <View style={styles.choiceText}>
                      <Text allowFontScaling={false} style={[styles.choiceName, unavailableReason ? styles.faint : null]}>
                        {exercise.name}
                      </Text>
                      {unavailableReason ? (
                        <Text allowFontScaling={false} style={[styles.detail, styles.faint]}>
                          {unavailableReason}
                        </Text>
                      ) : null}
                    </View>
                  </ListRow>
                ))}
              </View>
            ) : null}
            <RadioRow
              checked={option.kind === 'add-new'}
              divider
              label={`Add "${target.groupExercise.name}" as a new exercise`}
              onPress={() => setOption({ kind: 'add-new' })}
              testID="group-pick-sheet-option-add-new"
            />
          </ScrollView>
          <View style={styles.footer}>
            {chosen ? (
              <Text allowFontScaling={false} style={styles.note} testID="group-pick-sheet-retroactivity">
                {describeLinkRetroactivity(chosen.name, target.groupName)}
              </Text>
            ) : null}
            {loadModeNote ? (
              <Text allowFontScaling={false} style={styles.note} testID="group-pick-sheet-load-mode-note">
                {loadModeNote}
              </Text>
            ) : null}
            {error ? <Notice message={error} testID="group-pick-sheet-error" tone="danger" /> : null}
            {/* The sheet's one `accent` (G6, T14-D3). */}
            <ActionButton
              disabled={pending || (option.kind !== 'add-new' && !chosen)}
              label={option.kind === 'add-new' ? 'Create exercise…' : purpose === 'link-only' ? 'Link' : 'Link and add'}
              onPress={() => void confirm()}
              testID="group-pick-sheet-confirm"
              variant="primary"
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

function RadioGlyph({ checked, faint = false }: { checked: boolean; faint?: boolean }) {
  return <Icon color={faint ? uiRoles.inkFaint : uiRoles.ink} name={checked ? 'radio-on' : 'radio-off'} />;
}

function RadioRow({
  checked,
  label,
  detail,
  divider,
  onPress,
  testID,
}: {
  checked: boolean;
  label: string;
  detail?: string;
  divider: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <ListRow
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      checked={checked}
      divider={divider}
      leading={<RadioGlyph checked={checked} />}
      onPress={onPress}
      testID={testID}>
      <View style={styles.choiceText}>
        <Text allowFontScaling={false} style={styles.optionLabel}>
          {label}
        </Text>
        {detail ? (
          <Text allowFontScaling={false} style={styles.detail}>
            {detail}
          </Text>
        ) : null}
      </View>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  prompt: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
  list: {
    flexShrink: 1,
  },
  // The choices sit under "Choose another…", indented to its label.
  otherList: {
    paddingLeft: uiSpace.xl,
    paddingRight: uiSpace.lg,
    paddingBottom: uiSpace.sm,
  },
  search: {
    paddingVertical: uiSpace.sm,
  },
  choiceText: {
    paddingVertical: uiSpace.sm,
  },
  optionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  choiceName: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  detail: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  faint: {
    color: uiRoles.inkFaint,
  },
  footer: {
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
  },
  note: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
