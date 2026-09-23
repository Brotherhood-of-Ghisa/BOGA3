import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { uiSpace } from '@/components/ui/tokens';
import { formatElapsed } from '@/src/session-recorder/session-view-model';

type SessionSummaryCardProps = {
  startedAt: Date;
  gymName: string | null;
  performedSetCount: number;
  volume: string;
  // Opens the gym picker; the whole Gym cell is the target.
  onPressGym: () => void;
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

// Time / Gym / Sets / Volume, labels above values (build spec, "Session view").
export function SessionSummaryCard({
  startedAt,
  gymName,
  performedSetCount,
  volume,
  onPressGym,
  now = systemNow,
}: SessionSummaryCardProps) {
  return (
    <Card testID="session-view-summary">
      <View style={styles.row}>
        <ElapsedStat now={now} startedAt={startedAt} />
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
        <Stat align="end" label="Volume" testID="session-view-summary-volume" value={volume} />
      </View>
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
  gym: {
    flex: 1,
    minWidth: 0,
  },
});
