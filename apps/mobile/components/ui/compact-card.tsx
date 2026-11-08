import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { uiSpace } from '@/components/ui/tokens';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';

type CompactCardProps = ComponentProps<typeof Card> & { style?: never };

/** Compact standalone summary; feature content and Card actions keep their owners. */
export function CompactCard(props: CompactCardProps) {
  return <Card {...props} style={styles.card} />;
}

type CompactHeaderProps = {
  label: string;
  metadata?: string;
  metadataPlacement?: 'trailing' | 'inline';
  metadataAccessibilityLabel?: string;
  tone?: 'ink' | 'record' | 'muted';
  icon?: IconName;
  accessibilityRole?: 'header';
  testID?: string;
  labelTestID?: string;
  metadataTestID?: string;
};

/** The same wrapping label/date header also fits an existing embedded container. */
export function CompactHeader({ label, metadata, metadataPlacement = 'trailing', metadataAccessibilityLabel, tone = 'ink', icon,
  accessibilityRole, testID, labelTestID, metadataTestID }: CompactHeaderProps) {
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  return <View style={[styles.header, metadataPlacement === 'inline' ? styles.inlineHeader : null]} testID={testID}>
    <View style={styles.label} testID={testID ? `${testID}-label-row` : undefined}>
      <Text accessibilityRole={accessibilityRole} allowFontScaling={false}
        style={[textRoles.label, textTones[tone], styles.labelText]} testID={labelTestID}>{label}</Text>
      {icon ? <Icon name={icon} size="xs" /> : null}
    </View>
    {metadata ? <Text accessibilityLabel={metadataAccessibilityLabel} allowFontScaling={false}
      style={[textRoles.meta, styles.metadata, metadataPlacement === 'inline' ? styles.inlineMetadata : null]} testID={metadataTestID}>
      <FigureText>{metadata}</FigureText>
    </Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.sm, gap: uiSpace.xs },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: uiSpace.xs },
  // Text supplies the baseline; reverse order keeps the decorative icon leading.
  label: { flexDirection: 'row-reverse', alignItems: 'center', gap: uiSpace.xs, flexShrink: 1, maxWidth: '100%' },
  labelText: { flexShrink: 1 },
  metadata: { flexShrink: 1, minWidth: 0, marginLeft: 'auto', textAlign: 'right' },
  inlineHeader: { justifyContent: 'flex-start', gap: uiSpace.sm },
  inlineMetadata: { marginLeft: 0, textAlign: 'left' },
});
