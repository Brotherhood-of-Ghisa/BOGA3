import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
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
      <IconButton accessibilityLabel="Back to session" name="chevron-left" onPress={onBack} testID="exercise-page-back" />
      <Text allowFontScaling={false} accessibilityRole="header" numberOfLines={1} style={styles.title} testID="exercise-page-title">
        {title}
      </Text>
      {onOpenOptions ? (
        <IconButton
          accessibilityLabel="Exercise options"
          name="more-vertical"
          onPress={onOpenOptions}
          testID="exercise-page-options"
        />
      ) : (
        <View style={styles.spacer} />
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
  spacer: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
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
