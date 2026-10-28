import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, FigureText, uiSpace, uiText, uiTextTone } from '@/components/ui';

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
 * name as a title, its description and a meta line in `ink-muted`, then
 * any rows.
 */
export function GroupHeaderCard({ name, description, meta, nameTestID, metaTestID, testID, children }: GroupHeaderCardProps) {
  return (
    <Card testID={testID}>
      <View style={styles.words}>
        <Text allowFontScaling={false} accessibilityRole="header" style={uiText.title} testID={nameTestID}>
          {name}
        </Text>
        {description ? (
          <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]}>
            {description}
          </Text>
        ) : null}
        {meta ? (
          <Text allowFontScaling={false} style={[uiText.body, uiTextTone.muted]} testID={metaTestID}>
            <FigureText>{meta}</FigureText>
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
});
