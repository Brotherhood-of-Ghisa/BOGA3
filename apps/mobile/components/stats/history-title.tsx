import { Fragment, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { compareFamilySections, countFamilyMuscles, familyHasHeader } from '@/components/stats/progress-tables';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import { ExerciseSelectionSheet, type SelectedExercise } from './exercise-selection';

/** A muscle the title can switch to, as the user's muscle setup names and groups it. */
export type HistoryTitleMuscle = { id: string; displayName: string; familyName: string };

// Wide enough for a muscle's name, and clear of the back arrow and ⋮ on a
// 375pt phone.
const TITLE_MAX_WIDTH = 220;

/**
 * The history page's native header title, in the sheet-title role: a step
 * above the stack's title role; a long exercise name shrinks before it truncates.
 * Given muscles, it is a button: a chevron follows the name, and a tap opens a
 * sheet of the user's muscles in Progress's family sections, with the current
 * muscle checked.
 */
export function HistoryTitle({ title, muscles, currentId, onChoose, exercises }: {
  title: string;
  muscles?: readonly HistoryTitleMuscle[];
  currentId?: string;
  onChoose?: (muscleGroupId: string) => void;
  exercises?: readonly SelectedExercise[];
}) {
  const text = useUiText();
  const tone = useUiTextTone();
  const [open, setOpen] = useState(false);
  // A native header title: on the page, in the page inks.
  const label = <Text adjustsFontSizeToFit allowFontScaling={false} minimumFontScale={0.75} numberOfLines={1}
    style={[text.sheetTitle, tone.page, styles.text]} testID="progress-history-title-text">{title}</Text>;
  if (exercises) return <>
    <Pressable accessibilityHint="Shows the selected exercises" accessibilityLabel={`${title}, show names`}
      accessibilityRole="button" hitSlop={uiSpace.sm} onPress={() => setOpen(true)}
      style={({ pressed }) => [styles.root, pressed ? styles.pressed : null]} testID="progress-history-title">
      {label}<Icon colorRole="pageInkMuted" name="chevron-down" size="sm" />
    </Pressable>
    <ExerciseSelectionSheet exercises={exercises} visible={open} onDismiss={() => setOpen(false)} />
  </>;
  if (!muscles || muscles.length < 2 || !onChoose) {
    return <View accessibilityRole="header" accessible style={styles.root} testID="progress-history-title">{label}</View>;
  }
  const choose = (id: string) => {
    setOpen(false);
    if (id !== currentId) onChoose(id);
  };
  return (
    <>
      <Pressable accessibilityHint="Switches to another muscle" accessibilityLabel={`${title}, switch muscle`}
        accessibilityRole="button" hitSlop={uiSpace.sm} onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.root, pressed ? styles.pressed : null]} testID="progress-history-title">
        {label}
        <Icon colorRole="pageInkMuted" name="chevron-down" size="sm" />
      </Pressable>
      <Sheet dismissLabel="Dismiss muscles" onDismiss={() => setOpen(false)} testID="progress-history-muscle-sheet"
        title="Muscle" visible={open}>
        <ScrollView contentContainerStyle={styles.content}>
          {familySections(muscles).map(({ familyName, header, members }) => (
            <Fragment key={familyName}>
              {header ? <Text accessibilityRole="header" allowFontScaling={false}
                style={[text.label, styles.family]}>{familyName}</Text> : null}
              {members.map(muscle => {
                const checked = muscle.id === currentId;
                return <ListRow checked={checked} key={muscle.id} label={muscle.displayName}
                  leading={<Icon name={checked ? 'radio-on' : 'radio-off'} />} onPress={() => choose(muscle.id)}
                  testID={`progress-history-muscle-option-${muscle.id}`} />;
              })}
            </Fragment>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

/**
 * The muscles under their families as Progress sections them: a family header
 * only above two or more of the user's muscles, headerless families first, then
 * the fixed family order; muscles keep the order given.
 */
export const familySections = (muscles: readonly HistoryTitleMuscle[]) => {
  const counts = countFamilyMuscles(muscles.map(muscle => muscle.familyName));
  const families = new Map<string, HistoryTitleMuscle[]>();
  for (const muscle of muscles) {
    const members = families.get(muscle.familyName) ?? [];
    members.push(muscle);
    families.set(muscle.familyName, members);
  }
  return [...families]
    .sort(([left], [right]) => compareFamilySections(left, right, counts))
    .map(([familyName, members]) => ({ familyName, header: familyHasHeader(familyName, counts), members }));
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    maxWidth: TITLE_MAX_WIDTH,
  },
  pressed: { opacity: 0.6 },
  text: { flexShrink: 1 },
  content: { paddingBottom: uiSpace.lg },
  family: {
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.xs,
  },
});
