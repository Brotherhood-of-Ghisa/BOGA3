import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SessionInsightPresentation, type SessionComparisonMode } from '@/components/session-recorder/session-insight-presentation';
import { ActionButton } from '@/components/ui/action-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { CurrentSessionMuscleSummary, ExerciseVolumeComparison } from '@/src/session-insights';
import { PersonalRecordCard } from './personal-record-card';
import { SessionShareSheet, type SessionShareSnapshot } from './session-share-sheet';

export type MuscleCatalogState = 'loading' | 'ready' | 'error';

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

export function SessionMuscleBreakdown({
  performedSetCount, muscleSummary, muscleCatalogState, standalone = false,
}: {
  performedSetCount: number;
  muscleSummary: CurrentSessionMuscleSummary | null;
  muscleCatalogState: MuscleCatalogState;
  standalone?: boolean;
}) {
  const workingSetsByMuscle = muscleSummary?.workingSetsByMuscle ?? [];
  return (
    <>
      {performedSetCount > 0 ? (
        <View style={[styles.muscles, standalone && styles.standaloneMuscles]} testID="session-completion-muscle-breakdown">
          <Text allowFontScaling={false} style={styles.microLabel}>Working sets by muscle</Text>
          {workingSetsByMuscle.length > 0 ? (
            <View style={styles.pills}>
              {workingSetsByMuscle.map((muscle) => (
                <View
                  accessibilityLabel={`${muscle.displayName}, ${formatCount(muscle.workingSetCount, 'working set')}`}
                  accessible
                  key={muscle.id}
                  style={styles.pill}
                  testID={`session-completion-muscle-${muscle.id}`}>
                  <Text allowFontScaling={false} style={styles.pillName}>{muscle.displayName}</Text>
                  <Text allowFontScaling={false} style={styles.pillCount}>{muscle.workingSetCount}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text allowFontScaling={false} style={styles.muted} testID="session-completion-muscle-empty-state">
              {muscleCatalogState === 'loading'
                ? 'Loading muscle breakdown…'
                : muscleCatalogState === 'error'
                  ? 'Muscle breakdown unavailable.'
                  : 'No mapped working sets for this session.'}
            </Text>
          )}
        </View>
      ) : null}
    </>
  );
}

export type SessionSummaryContentProps = SessionShareSnapshot & {
  muscleVolumeComparisons?: ExerciseVolumeComparison[];
  historyState?: 'loading' | 'ready' | 'error';
  unavailableMessage?: string;
  muscleCatalogState?: MuscleCatalogState;
  comparisonMode?: SessionComparisonMode;
  onComparisonModeChange?: (mode: SessionComparisonMode) => void;
  shouldFailNextShare?: boolean;
};

/** Shared summary body; each host owns its facts, header and navigation. */
export function SessionSummaryContent({
  completedAt, durationDisplay, exerciseCount, performedSetCount, workingSetCount,
  personalRecords, exerciseVolumeComparisons, muscleVolumeComparisons = [],
  historyState = 'ready', unavailableMessage, muscleCatalogState = 'ready', comparisonMode, onComparisonModeChange,
  shouldFailNextShare = false,
}: SessionSummaryContentProps) {
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);
  return (
    <>
      {personalRecords.length > 0 ? (
        <View style={styles.section} testID="session-completion-personal-records">
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>
            Personal records
          </Text>
          {personalRecords.map((personalRecord) => (
            <PersonalRecordCard
              key={personalRecord.setId}
              personalRecord={personalRecord}
              testID={`session-completion-pr-${personalRecord.exerciseDefinitionId}`}
            />
          ))}
        </View>
      ) : null}

      <SessionInsightPresentation
        exerciseComparisons={exerciseVolumeComparisons}
        muscleComparisons={muscleVolumeComparisons}
        historyState={historyState}
        unavailableMessage={unavailableMessage}
        muscleCatalogState={muscleCatalogState}
        mode={comparisonMode}
        onModeChange={onComparisonModeChange}
        testIdPrefix="session-completion"
      />

      <ActionButton
        accessibilityHint="Opens a preview of the complete session image."
        label="Share session"
        onPress={() => setIsSharePreviewOpen(true)}
        testID="session-completion-share-session"
        variant="outline"
      />
      <SessionShareSheet
        onClose={() => setIsSharePreviewOpen(false)}
        shouldFailNextShare={shouldFailNextShare}
        snapshot={{
          completedAt,
          durationDisplay,
          exerciseCount,
          performedSetCount,
          workingSetCount,
          personalRecords,
          exerciseVolumeComparisons,
        }}
        visible={isSharePreviewOpen}
      />
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
  },
  heading: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  muscles: {
    marginHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
    gap: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  standaloneMuscles: {
    borderTopWidth: 0,
    paddingTop: uiSpace.md,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.control,
    backgroundColor: uiRoles.surfaceSubtle,
  },
  pillName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  pillCount: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
