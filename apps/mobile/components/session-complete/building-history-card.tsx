import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { MIN_HISTORY_OBSERVATIONS } from '@/src/utils/history-reference';

// The cutoff in words, so the card states the rule instead of a bare count.
const RULE = `A volume comparison needs ${MIN_HISTORY_OBSERVATIONS} prior comparable sessions.`;

type BuildingHistoryCardProps = {
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
export function BuildingHistoryCard({ names, testID }: BuildingHistoryCardProps) {
  if (names.length === 0) return null;
  return (
    <Card testID={testID}>
      <View accessibilityLabel={`Building history. ${RULE} ${names.join(', ')}.`} accessible style={styles.body}>
        <Text allowFontScaling={false} style={styles.title}>Building history</Text>
        <Text allowFontScaling={false} style={styles.rule}>{RULE}</Text>
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
  // A card's own title, a step below the section heading (`design-language.md` §3).
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  rule: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
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
