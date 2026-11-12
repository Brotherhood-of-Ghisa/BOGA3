import { StyleSheet, Text, View } from 'react-native';

import { useUiText, useUiTextTone } from '@/components/ui';

// Clear of the back arrow and one header button on a 375pt phone.
const TITLE_MAX_WIDTH = 220;

/**
 * A board screen's native header title on two rows: the exercise, then which
 * view of it this is (`1RM leaderboard`, `Volume history`).
 */
export function GroupBoardTitle({ name, view, testID }: { name: string; view: string; testID: string }) {
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <View accessibilityLabel={`${name}, ${view}`} accessibilityRole="header" accessible style={styles.title} testID={testID}>
      <Text adjustsFontSizeToFit allowFontScaling={false} minimumFontScale={0.75} numberOfLines={1}
        style={text.sheetTitle} testID={`${testID}-name`}>
        {name}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[text.label, tone.muted]} testID={`${testID}-view`}>
        {view}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    alignItems: 'center',
    maxWidth: TITLE_MAX_WIDTH,
  },
});
