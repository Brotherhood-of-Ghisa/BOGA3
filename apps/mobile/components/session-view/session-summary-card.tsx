import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

import { SessionTimesFields, type SessionTimesFieldsProps } from './session-times-fields';

type SessionSummaryCardProps = {
  gymName: string | null;
  exerciseCount: number;
  workingSetCount: number;
  volume: string;
  volumeNote?: string;
  // Opens the gym picker; the whole Gym cell is the target.
  onPressGym: () => void;
  // A completed session being edited: its Start/End fields, above the row.
  times?: SessionTimesFieldsProps;
};

// Gym / Ex (exercises) / Sets / Volume, labels above values (`ux-rules` §14b.5);
// the elapsed time is in the top bar's title. Editing a completed session,
// Start and End sit above the row.
export function SessionSummaryCard({
  gymName,
  exerciseCount,
  workingSetCount,
  volume,
  volumeNote,
  onPressGym,
  times,
}: SessionSummaryCardProps) {
  return (
    <Card testID="session-view-summary">
      {times ? <SessionTimesFields {...times} /> : null}
      <View style={styles.row}>
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
        <Stat label="Ex" spokenLabel="Exercises" testID="session-view-summary-exercises" value={String(exerciseCount)} />
        <Stat label="Sets" testID="session-view-summary-sets" value={String(workingSetCount)} />
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
