import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';

type GroupHeaderCardProps = {
  name: string;
  description?: string | null;
  /** A line under the name in `ink-muted` (the Members screen's count and role). */
  meta?: string;
  nameTestID?: string;
  metaTestID?: string;
  testID?: string;
  /** Rows below the words, each bringing its own hairline (the group screen's members link). */
  children?: ReactNode;
};

/**
 * The header of the group and Members screens: one `Card` with the group's
 * name in Archivo 700, its description and a meta line in `ink-muted`, then
 * any rows.
 */
export function GroupHeaderCard({ name, description, meta, nameTestID, metaTestID, testID, children }: GroupHeaderCardProps) {
  return (
    <Card testID={testID}>
      <View style={styles.words}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.name} testID={nameTestID}>
          {name}
        </Text>
        {description ? (
          <Text allowFontScaling={false} style={styles.muted}>
            {description}
          </Text>
        ) : null}
        {meta ? (
          <Text allowFontScaling={false} style={styles.muted} testID={metaTestID}>
            {meta}
          </Text>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  words: {
    gap: uiSpace.xs,
    padding: uiSpace.md,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
