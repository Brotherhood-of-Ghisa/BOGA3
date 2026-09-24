import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type SessionFact = {
  label: string;
  value: string;
  // `text` sets a name (a gym) in the body face; it takes the row's spare width.
  kind?: 'figure' | 'text';
  // `end` right-aligns a trailing column.
  align?: 'start' | 'end';
  testID?: string;
};

type SessionFactsCardProps = {
  // Above everything: the group view's member and status.
  header?: ReactNode;
  // A finished session's Start and End, as `YYYY-MM-DD HH:mm`: the layout of the
  // completed edit's Start/End fields (`session-times-fields.tsx`), read-only.
  times?: { start: string; end: string; testID?: string };
  // One row of facts, or several (the completion card's two).
  facts: SessionFact[] | SessionFact[][];
  // Below the facts: the completion's muscle breakdown.
  children?: ReactNode;
  testID?: string;
};

// A session's facts as stacked `Stat`s in one `Card` (Duration / Gym / Sets /
// Volume), shared by View Session and the group session view.
export function SessionFactsCard({ header, times, facts, children, testID }: SessionFactsCardProps) {
  const rows = (Array.isArray(facts[0]) ? facts : [facts]) as SessionFact[][];
  return (
    <Card testID={testID}>
      {header}
      {times ? (
        <View style={styles.times} testID={times.testID}>
          <TimeReadout label="Start" testID={times.testID ? `${times.testID}-start` : undefined} value={times.start} />
          <TimeReadout label="End" testID={times.testID ? `${times.testID}-end` : undefined} value={times.end} />
        </View>
      ) : null}
      {rows.map((row) => (
        <View key={row.map((fact) => fact.label).join('|')} style={styles.row}>
          {row.map((fact) => (
            <View key={fact.label} style={fact.kind === 'text' ? styles.flexible : null}>
              <Stat align={fact.align} kind={fact.kind} label={fact.label} testID={fact.testID} value={fact.value} />
            </View>
          ))}
        </View>
      ))}
      {children}
    </Card>
  );
}

function TimeReadout({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View accessibilityLabel={`${label} ${value}`} accessible style={styles.time} testID={testID}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.timeValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  times: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
  },
  time: {
    flex: 1,
    minWidth: 0,
  },
  timeLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  // The edit field's figure: `base` fits the 16 characters of a time in half
  // the card's width.
  timeValue: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.lg,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  flexible: {
    flex: 1,
    minWidth: 0,
  },
});
