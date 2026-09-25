import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseVolumeCard } from '@/components/session-complete/exercise-volume-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SectionHeader } from '@/components/ui/page-header';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { ExerciseVolumeComparison } from '@/src/session-insights';

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
  return (
    <View style={styles.section} testID="session-insight-presentation">
      <SegmentedControl
        accessibilityLabel="Session comparison grouping"
        onChange={setMode}
        options={[{ value: 'exercise', label: 'By exercise' }, { value: 'muscle', label: 'By muscle' }]}
        testIDPrefix="session-insight-mode"
        value={mode}
      />
      <View style={styles.section} testID={`${testIdPrefix}-${mode}-volume`}>
        <SectionHeader title={mode === 'exercise' ? 'Exercise volume' : 'Muscle volume'} />
        <Text allowFontScaling={false} style={styles.muted}>Session vs history</Text>
        {state === 'ready' && comparisons.length ? comparisons.map((comparison) => (
          <ExerciseVolumeCard
            comparison={comparison}
            key={`${mode}-${comparison.exerciseDefinitionId ?? 'legacy'}-${comparison.sessionExerciseIds.join('-')}`}
            testID={`${testIdPrefix}-${mode === 'muscle' ? 'muscle-comparison' : 'exercise'}-${comparison.sessionExerciseIds[0]}`}
          />
        )) : (
          <Text allowFontScaling={false} style={styles.muted} testID="session-insight-empty">
            {state === 'loading' ? 'Loading comparisons…'
              : state === 'error' ? unavailableMessage
                : mode === 'muscle' ? 'No mapped performed sets for this session.' : 'No performed sets to compare.'}
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
