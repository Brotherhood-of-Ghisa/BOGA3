import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BuildingHistoryCard } from '@/components/session-complete/building-history-card';
import { ExerciseVolumeCard } from '@/components/session-complete/exercise-volume-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SectionHeader } from '@/components/ui/page-header';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { partitionVolumeComparisons, type ExerciseVolumeComparison } from '@/src/session-insights';

export type SessionComparisonMode = 'exercise' | 'muscle';

type Props = {
  mode?: SessionComparisonMode;
  onModeChange?: (mode: SessionComparisonMode) => void;
  exerciseComparisons: ExerciseVolumeComparison[];
  muscleComparisons?: ExerciseVolumeComparison[];
  historyState?: 'loading' | 'ready' | 'error';
  unavailableMessage?: string;
  muscleCatalogState?: 'loading' | 'ready' | 'error';
  testIdPrefix?: string;
};

export function SessionInsightPresentation({
  mode: selectedMode,
  onModeChange,
  exerciseComparisons,
  muscleComparisons = [],
  historyState = 'ready',
  unavailableMessage = 'Comparisons unavailable. Return to this session to retry.',
  muscleCatalogState = 'ready',
  testIdPrefix = 'session-insight',
}: Props) {
  const [localMode, setLocalMode] = useState<SessionComparisonMode>('exercise');
  const mode = selectedMode ?? localMode;
  const setMode = onModeChange ?? setLocalMode;
  const comparisons = mode === 'exercise' ? exerciseComparisons : muscleComparisons;
  const state = historyState !== 'ready' ? historyState : mode === 'muscle' ? muscleCatalogState : 'ready';
  // A comparison with no distribution gets no card: it is pooled by name
  // ([[session.volume-comparison]]), so no card ever draws an empty plot.
  const { comparable, buildingHistory } = partitionVolumeComparisons(comparisons);
  return (
    <View style={styles.section} testID="session-insight-presentation">
      <SectionHeader title="Volume" />
      <SegmentedControl
        accessibilityLabel="Session comparison grouping"
        onChange={setMode}
        options={[{ value: 'exercise', label: 'By exercise' }, { value: 'muscle', label: 'By muscle' }]}
        testIDPrefix="session-insight-mode"
        value={mode}
      />
      <View style={styles.section} testID={`${testIdPrefix}-${mode}-volume`}>
        {state === 'ready' && comparisons.length ? (
          <>
            {comparable.map((comparison) => (
              <ExerciseVolumeCard
                comparison={comparison}
                key={`${mode}-${comparison.exerciseDefinitionId ?? 'legacy'}-${comparison.sessionExerciseIds.join('-')}`}
                testID={`${testIdPrefix}-${mode === 'muscle' ? 'muscle-comparison' : 'exercise'}-${comparison.sessionExerciseIds[0]}`}
              />
            ))}
            <BuildingHistoryCard names={buildingHistory} testID={`${testIdPrefix}-building-history-${mode}`} />
          </>
        ) : (
          <Text allowFontScaling={false} style={styles.muted} testID="session-insight-empty">
            {state === 'loading' ? 'Loading comparisons…'
              : state === 'error' ? unavailableMessage
                : mode === 'muscle' ? 'No mapped working sets for this session.' : 'No working sets to compare.'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: uiSpace.sm },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});
