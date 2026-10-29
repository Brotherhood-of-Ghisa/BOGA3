import { Fragment, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { uiText } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';

/** A muscle the title can switch to, as the user's muscle setup names and groups it. */
export type HistoryTitleMuscle = { id: string; displayName: string; familyName: string };

// Wide enough for a muscle's name; the back arrow and ⋮ keep their slots.
const TITLE_MAX_WIDTH = 260;

/**
 * The history page's native header title, in the page-title role rather than
 * the stack's smaller one; a long exercise name shrinks before it truncates.
 * Given muscles, it is a button: a chevron follows the name, and a tap opens a
 * sheet of the user's muscles by family, the current one checked.
 */
export function HistoryTitle({ title, muscles, currentId, onChoose }: {
  title: string;
  muscles?: readonly HistoryTitleMuscle[];
  currentId?: string;
  onChoose?: (muscleGroupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = <Text adjustsFontSizeToFit allowFontScaling={false} minimumFontScale={0.75} numberOfLines={1}
    style={[uiText.pageTitle, styles.text]} testID="progress-history-title-text">{title}</Text>;
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
        <Icon color={uiRoles.inkMuted} name="chevron-down" size="sm" />
      </Pressable>
      <Sheet dismissLabel="Dismiss muscles" onDismiss={() => setOpen(false)} testID="progress-history-muscle-sheet"
        title="Muscle" visible={open}>
        <ScrollView contentContainerStyle={styles.content}>
          {familiesOf(muscles).map(({ familyName, members }) => (
            <Fragment key={familyName}>
              <Text accessibilityRole="header" allowFontScaling={false} style={[uiText.label, styles.family]}>{familyName}</Text>
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

/** The muscles under their families, both in the order given. */
export const familiesOf = (muscles: readonly HistoryTitleMuscle[]) => {
  const families = new Map<string, HistoryTitleMuscle[]>();
  for (const muscle of muscles) {
    const members = families.get(muscle.familyName) ?? [];
    members.push(muscle);
    families.set(muscle.familyName, members);
  }
  return [...families].map(([familyName, members]) => ({ familyName, members }));
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
