import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SessionInsightPresentation, type SessionComparisonMode } from '@/components/session-recorder/session-insight-presentation';
import { ActionButton } from '@/components/ui/action-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type {
  CurrentSessionMuscleSummary, ExerciseVolumeComparison, SessionMuscleWorkingSetEntry,
} from '@/src/session-insights';
import { PersonalRecordCard } from './personal-record-card';
import { SessionShareSheet, type SessionShareSnapshot } from './session-share-sheet';

export type MuscleCatalogState = 'loading' | 'ready' | 'error';

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

const MUSCLE_TABLE_COLUMNS = ['Pri', 'Sec', 'Sets'] as const;

const muscleRowLabel = (muscle: SessionMuscleWorkingSetEntry): string =>
  `${muscle.displayName}, ${formatCount(muscle.weightedSetCount, 'set')}: ` +
  `${muscle.primarySetCount} primary, ${muscle.secondarySetCount} secondary`;

// A role with no sets is an absent value: a dash in `ink-ghost`.
function RoleCount({ count }: { count: number }) {
  return (
    <Text allowFontScaling={false} style={[styles.count, styles.countCell, count === 0 && styles.absent]}>
      {count === 0 ? '—' : String(count)}
    </Text>
  );
}

export function SessionMuscleBreakdown({
  workingSetCount, muscleSummary, muscleCatalogState, standalone = false,
}: {
  workingSetCount: number;
  muscleSummary: CurrentSessionMuscleSummary | null;
  muscleCatalogState: MuscleCatalogState;
  standalone?: boolean;
}) {
  const workingSetsByMuscle = muscleSummary?.workingSetsByMuscle ?? [];
  return (
    <>
      {workingSetCount > 0 ? (
        <View style={[styles.muscles, standalone && styles.standaloneMuscles]} testID="session-completion-muscle-breakdown">
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.cardTitle}>Sets by muscle</Text>
          {workingSetsByMuscle.length > 0 ? (
            <View testID="session-completion-muscle-table">
              <View style={styles.tableRow}>
                <Text allowFontScaling={false} style={[styles.microLabel, styles.nameCell]}>Muscle</Text>
                {MUSCLE_TABLE_COLUMNS.map((column) => (
                  <Text allowFontScaling={false} key={column} style={[styles.microLabel, styles.countCell]}>{column}</Text>
                ))}
              </View>
              {workingSetsByMuscle.map((muscle) => (
                <View
                  accessibilityLabel={muscleRowLabel(muscle)}
                  accessible
                  key={muscle.id}
                  style={[styles.tableRow, styles.bodyRow]}
                  testID={`session-completion-muscle-${muscle.id}`}>
                  <Text allowFontScaling={false} style={[styles.muscleName, styles.nameCell]}>{muscle.displayName}</Text>
                  <RoleCount count={muscle.primarySetCount} />
                  <RoleCount count={muscle.secondarySetCount} />
                  <Text allowFontScaling={false} style={[styles.count, styles.countCell, styles.total]}>
                    {String(muscle.weightedSetCount)}
                  </Text>
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
  completedAt, durationDisplay, exerciseCount, workingSetCount,
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
  // A card's own title: Archivo 700 at `md` in `ink`, a step below the
  // page's `lg` section headings and clear of the micro-label column heads.
  cardTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
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
  tableRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  bodyRow: {
    paddingVertical: uiSpace.xs,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  nameCell: {
    flex: 1,
  },
  countCell: {
    width: uiGeometry.metricValueWidth,
    textAlign: 'right',
  },
  muscleName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  count: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
  total: {
    fontWeight: '600',
    color: uiRoles.ink,
  },
  absent: {
    color: uiRoles.inkGhost,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
