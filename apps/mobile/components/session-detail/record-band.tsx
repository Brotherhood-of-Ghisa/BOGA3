import { Text, View } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiSpace } from '@/components/ui/tokens';
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
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  if (lines.length === 0) return null;
  return (
    <View style={[styles.band, placement === 'footer' ? styles.footer : styles.header]} testID={testID}>
      {lines.map((line, index) => (
        <View key={line.key} style={[styles.line, index > 0 ? styles.lineRuled : null]} testID={`${testID}-${index + 1}`}>
          <Text allowFontScaling={false} style={[text.label, tone.record, styles.label]}>
            <FigureText figureStyle={tone.record}>{line.label}</FigureText>
          </Text>
          {line.set ? (
            <Text allowFontScaling={false} numberOfLines={1} style={[text.figureSmall, tone.record, styles.set]}>{line.set}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  band: {
    backgroundColor: roles.recordWash,
  },
  footer: {
    borderTopWidth: uiBorder.width,
    borderTopColor: roles.recordRule,
  },
  header: {
    borderBottomWidth: uiBorder.width,
    borderBottomColor: roles.recordRule,
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
    borderTopColor: roles.recordRule,
  },
  label: {
    flexShrink: 1,
  },
  // The set a line names, right-aligned.
  set: {
    flexShrink: 0,
    marginLeft: 'auto',
  },
}));
