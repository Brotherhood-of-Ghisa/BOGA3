import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { formatElapsed } from '@/src/session-recorder/session-view-model';

import { SessionTimesFields, type SessionTimesFieldsProps } from './session-times-fields';

type SessionSummaryCardProps = {
  startedAt: Date;
  gymName: string | null;
  performedSetCount: number;
  volume: string;
  volumeNote?: string;
  // Opens the gym picker; the whole Gym cell is the target.
  onPressGym: () => void;
  // A completed session being edited: its Start/End fields replace the
  // elapsed Time.
  times?: SessionTimesFieldsProps;
  // Injectable clock for tests.
  now?: () => Date;
};

// Time ticks on its own so the rest of the screen does not re-render each second.
function ElapsedStat({ startedAt, now }: { startedAt: Date; now: () => Date }) {
  const [current, setCurrent] = useState(now);
  useEffect(() => {
    const interval = setInterval(() => setCurrent(now()), 1000);
    return () => clearInterval(interval);
  }, [now]);

  return <Stat label="Time" testID="session-view-summary-time" value={formatElapsed(startedAt, current)} />;
}

const systemNow = () => new Date();

// Time / Gym / Sets / Volume, labels above values (`ux-rules` §14b.5).
// Editing a completed session, Start and End take Time's place, above the row.
export function SessionSummaryCard({
  startedAt,
  gymName,
  performedSetCount,
  volume,
  volumeNote,
  onPressGym,
  times,
  now = systemNow,
}: SessionSummaryCardProps) {
  return (
    <Card testID="session-view-summary">
      {times ? <SessionTimesFields {...times} /> : null}
      <View style={styles.row}>
        {times ? null : <ElapsedStat now={now} startedAt={startedAt} />}
        <Pressable
          accessibilityHint="Choose the gym for this session"
          accessibilityLabel={`Gym ${gymName ?? 'No gym'}`}
          accessibilityRole="button"
          hitSlop={uiSpace.sm}
          onPress={onPressGym}
          style={styles.gym}
          testID="session-view-summary-gym-button">
          <Stat kind="text" label="Gym" testID="session-view-summary-gym" value={gymName ?? 'No gym'} />
        </Pressable>
        <Stat label="Sets" testID="session-view-summary-sets" value={String(performedSetCount)} />
        <Stat align="end" label={volumeNote && volume !== '—' ? 'Known vol' : 'Volume'} testID="session-view-summary-volume" value={volume} />
      </View>
      {volumeNote ? <Text allowFontScaling={false} style={styles.coverageNote}
        testID="session-view-summary-volume-note">{volumeNote}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.lg,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
  coverageNote: {
    paddingHorizontal: uiSpace.md, paddingBottom: uiSpace.sm,
    fontFamily: uiFonts.body.family, fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm, color: uiRoles.inkMuted,
  },
  gym: {
    flex: 1,
    minWidth: 0,
  },
});
