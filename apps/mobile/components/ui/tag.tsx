import { StyleSheet, Text, View } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

// `neutral`: a fact about the row (`Archived`, a role). `faint`: a row that has
// stepped back (`Deleted`), drawn fainter still.
export type TagTone = 'neutral' | 'faint';

export type TagProps = {
  label: string;
  tone?: TagTone;
  testID?: string;
};

// A static pill naming a state in words (`Archived`, `Deleted`, `Admin`), so
// the state never rides colour alone. Not pressable.
export function Tag({ label, tone = 'neutral', testID }: TagProps) {
  return (
    <View style={[styles.tag, tone === 'faint' ? styles.tagFaint : null]} testID={testID}>
      <Text style={[styles.label, tone === 'faint' ? styles.labelFaint : null]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: uiSpace.sm,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.surface,
  },
  tagFaint: {
    borderColor: uiRoles.ruleSoft,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  labelFaint: {
    color: uiRoles.inkFaint,
  },
});
