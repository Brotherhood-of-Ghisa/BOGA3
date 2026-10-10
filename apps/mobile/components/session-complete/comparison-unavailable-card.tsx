import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

// One statement: what is missing, and what it takes. The cutoff counts the
// sessions *before* this one, so the card's count includes it — the session
// just finished is the lifter's nth, and the comparison lands on the next.
const STATEMENT = `Comparison unavailable — needs at least ${MIN_HISTORY_OBSERVATIONS + 1} sessions`;

type ComparisonUnavailableCardProps = {
  /** Exercise or muscle names, in the order the session lists them. */
  names: string[];
  testID?: string;
};

/**
 * Implements the low-history half of [[session.volume-comparison]]: the
 * exercises (or muscles) a session cannot compare yet, pooled by name in one
 * secondary card instead of a comparison card each. Names only — the volume
 * card is the only place a distribution is drawn, so nothing here suggests a
 * plot is missing. One accessible node: a shortfall is read as one statement.
 */
export function ComparisonUnavailableCard({ names, testID }: ComparisonUnavailableCardProps) {
  if (names.length === 0) return null;
  return (
    <Card testID={testID}>
      <View accessibilityLabel={`${STATEMENT}. ${names.join(', ')}.`} accessible style={styles.body}>
        <Text allowFontScaling={false} style={styles.statement}>{STATEMENT}</Text>
        <View style={styles.names}>
          {names.map((name, index) => (
            <Text allowFontScaling={false} key={`${index}-${name}`} style={styles.name}>{name}</Text>
          ))}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    gap: uiSpace.xs,
  },
  // The card's own line, a step below the section heading (`design-language.md` §3).
  statement: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  names: {
    paddingTop: uiSpace.xs,
    gap: uiSpace.xs,
  },
  name: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});
