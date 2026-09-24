import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

type ExerciseTopBarProps = {
  title: string;
  onBack: () => void;
  // Omitted while the page has no exercise to act on (loading, error).
  onOpenOptions?: () => void;
};

// Back · exercise name · ⋮. No subtitle (`ux-rules` §14a).
export function ExerciseTopBar({ title, onBack, onOpenOptions }: ExerciseTopBarProps) {
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityLabel="Back to session"
        accessibilityRole="button"
        onPress={onBack}
        style={styles.control}
        testID="exercise-page-back">
        <Icon color={uiRoles.ink} name="chevron-left" />
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title} testID="exercise-page-title">
        {title}
      </Text>
      {onOpenOptions ? (
        <Pressable
          accessibilityLabel="Exercise options"
          accessibilityRole="button"
          onPress={onOpenOptions}
          style={styles.control}
          testID="exercise-page-options">
          <Icon color={uiRoles.ink} name="more-vertical" />
        </Pressable>
      ) : (
        <View style={styles.control} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingHorizontal: uiSpace.xs,
    backgroundColor: uiRoles.surface,
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.rule,
  },
  control: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
});
