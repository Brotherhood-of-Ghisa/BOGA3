import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { IconButton, Sheet } from '@/components/ui';
import { curveStyles as styles } from './styles';

const SECTIONS = [
  ['Reading the chart', 'Each dot is a working set. Up means more load; right means more reps. RIR means reps you felt you had left: eight reps with two left is plotted at ten. Per side means one side. On bodyweight exercises, Load can include part of your bodyweight.'],
  ['The soft halo', 'For eight reps with two left, the halo spans nine to eleven. The model allows one rep either way for positive RIR; it treats RIR 0 as exact. This halo shows that assumption, not a measured confidence level.'],
  ['Gym, time and effort', 'These filters decide which sets count. All gyms pools their histories, even when equipment differs. All known RIR uses sets with a recorded estimate of reps left. The time filter narrows the dates.'],
  ['One curve / Two curves', 'One curve treats the selected history as one strength level. Two curves looks for an earlier and a later level, and a possible date between them.'],
  ['Parsimonious / Rich', 'Parsimonious uses fixed assumptions about everyday variation and RIR guesswork. Rich tries to learn that variation from your history too. It can need more data; it is not automatically more reliable.'],
  ['1RM and fitting sessions', 'The curve’s 1RM is its estimate of the load for one all-out rep. To draw the line, each completed workout supplies its set with the highest estimated 1RM. Fitting sessions counts those workouts; the dots show all matching sets.'],
  ['Exploratory fit', 'This is a pattern to explore, not proof that your strength changed. Tap a dot to inspect the set behind it.'],
] as const;

/** Help is requested explicitly; opening or dismissing it never changes chart scope. */
export function RmCurveHelp() {
  const [visible, setVisible] = useState(false);
  return <>
    <IconButton name="info" tone="muted" size="sm" accessibilityLabel="About the RM curve"
      testID="rm-curve-info" onPress={() => setVisible(true)} />
    <Sheet visible={visible} title="About the RM curve" dismissLabel="Dismiss RM curve explanation"
      testID="rm-curve-help" onDismiss={() => setVisible(false)}>
      <ScrollView style={styles.helpScroll} contentContainerStyle={styles.helpContent}>
        <Text allowFontScaling={false} style={styles.body}>
          Heavy weights usually mean fewer reps. The curve uses your past sets to estimate that trade-off for this exercise. It can also look for a possible change in strength over time.
        </Text>
        {SECTIONS.map(([title, body]) => <View key={title} style={styles.helpSection}>
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.filterLabel}>{title}</Text>
          <Text allowFontScaling={false} style={styles.body}>{body}</Text>
        </View>)}
      </ScrollView>
    </Sheet>
  </>;
}
