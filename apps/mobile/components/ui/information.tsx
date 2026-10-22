import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { uiFonts, uiGeometry, uiIconSize, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type InformationProps = {
  title: string;
  body: string;
  sections?: readonly (readonly [title: string, body: string])[];
  /** Optional heading beside the glyph, with a 4pt visual gap. */
  label?: string;
  /** `<prefix>-info` on the trigger; `<prefix>-help` on the sheet. */
  testIDPrefix?: string;
};

/** On-demand prose in a content-height Sheet; long explanations scroll. */
export function Information({ title, body, sections = [], label, testIDPrefix }: InformationProps) {
  const [visible, setVisible] = useState(false);
  return <>
    <View style={styles.row}>
      {label ? <Text allowFontScaling={false} accessibilityRole="header" style={styles.label}>{label}</Text> : null}
      <View style={label ? styles.besideLabel : undefined}>
        <IconButton name="info" tone="muted" size="sm" accessibilityLabel={title}
          testID={testIDPrefix ? `${testIDPrefix}-info` : undefined} onPress={() => setVisible(true)} />
      </View>
    </View>
    <Sheet visible={visible} title={title} dismissLabel={`Dismiss ${title}`}
      testID={testIDPrefix ? `${testIDPrefix}-help` : undefined} onDismiss={() => setVisible(false)}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text allowFontScaling={false} style={styles.body}>{body}</Text>
        {sections.map(([heading, text]) => <View key={heading} style={styles.section}>
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>{heading}</Text>
          <Text allowFontScaling={false} style={styles.body}>{text}</Text>
        </View>)}
      </ScrollView>
    </Sheet>
  </>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  // Discount the centred glyph's inset; the full 44pt target remains intact.
  besideLabel: { marginLeft: uiSpace.xs - (uiGeometry.tapTarget - uiIconSize.sm) / 2 },
  label: { flexShrink: 1, fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl, color: uiRoles.ink },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: uiSpace.lg, paddingBottom: uiSpace.sm, gap: uiSpace.lg },
  section: { gap: uiSpace.xs },
  heading: { fontFamily: uiFonts.display.family, fontWeight: '600', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
  body: { fontFamily: uiFonts.body.family, fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.inkMuted },
});
