import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { RecordLine } from '@/src/session-insights/record-band';

type RecordBandProps = {
  lines: readonly RecordLine[];
  // `footer` closes a card (the exercise cards), ruled above; `header` opens
  // one (the exercise page's set list), ruled below.
  placement: 'footer' | 'header';
  // `<testID>-<n>` hangs off each line.
  testID: string;
};

// The `record` band: one line per record, its words then, right-aligned, the
// set that took it (`session-insights/record-band.ts`). Nothing for no lines.
export function RecordBand({ lines, placement, testID }: RecordBandProps) {
  if (lines.length === 0) return null;
  return (
    <View style={[styles.band, placement === 'footer' ? styles.footer : styles.header]} testID={testID}>
      {lines.map((line, index) => (
        <View key={line.key} style={[styles.line, index > 0 ? styles.lineRuled : null]} testID={`${testID}-${index + 1}`}>
          <Icon color={uiRoles.record} name="arrow-up" size="xs" />
          <Text allowFontScaling={false} style={styles.label}>{line.label}</Text>
          {line.set ? (
            <Text allowFontScaling={false} numberOfLines={1} style={styles.set}>{line.set}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: uiRoles.recordWash,
  },
  footer: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  header: {
    borderBottomWidth: uiBorder.width,
    borderBottomColor: uiRoles.recordRule,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  lineRuled: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.recordRule,
  },
  label: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.record,
  },
  // The set a line names, right-aligned in the figure face.
  set: {
    marginLeft: 'auto',
    fontFamily: uiFonts.figure.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.record,
  },
});
