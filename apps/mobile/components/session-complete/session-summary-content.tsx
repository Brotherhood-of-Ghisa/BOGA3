import { useState } from 'react';
import { Text, View } from 'react-native';

import { SessionInsightPresentation, type SessionComparisonMode } from '@/components/session-recorder/session-insight-presentation';
import { ActionButton } from '@/components/ui/action-button';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';
import { formatWorkingSetCount } from '@/src/exercise-calculations/format';
import type {
  CurrentSessionMuscleSummary, ExerciseVolumeComparison, SessionMuscleWorkingSetEntry,
} from '@/src/session-insights';
import { PersonalRecordCard } from './personal-record-card';
import { SessionShareSheet, type SessionShareSnapshot } from './session-share-sheet';

export type MuscleCatalogState = 'loading' | 'ready' | 'error';

const formatCount = (count: number, singular: string): string => {
  const figure = formatWorkingSetCount(count);
  return `${figure} ${figure === '1' ? singular : `${singular}s`}`;
};

const MUSCLE_TABLE_COLUMNS = ['Pri', 'Sec', 'Sets'] as const;

const muscleRowLabel = (muscle: SessionMuscleWorkingSetEntry): string =>
  `${muscle.displayName}, ${formatCount(muscle.weightedSetCount, 'set')}: ` +
  `${formatWorkingSetCount(muscle.primarySetCount)} primary, ${formatWorkingSetCount(muscle.secondarySetCount)} secondary`;

// A role with no sets is an absent value: a dash in `faint`.
function RoleCount({ count }: { count: number }) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const figure = formatWorkingSetCount(count);
  return (
    <Text allowFontScaling={false} style={[text.figure, figure === '0' ? tone.faint : tone.muted, styles.countCell]}>
      {figure === '0' ? '—' : figure}
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
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const workingSetsByMuscle = muscleSummary?.workingSetsByMuscle ?? [];
  return (
    <>
      {workingSetCount > 0 ? (
        <View style={[styles.muscles, standalone && styles.standaloneMuscles]} testID="session-completion-muscle-breakdown">
          <Text allowFontScaling={false} accessibilityRole="header" style={text.title}>Sets by muscle</Text>
          {workingSetsByMuscle.length > 0 ? (
            <View testID="session-completion-muscle-table">
              <View style={styles.tableRow}>
                <Text allowFontScaling={false} style={[text.label, tone.faint, styles.nameCell]}>Muscle</Text>
                {MUSCLE_TABLE_COLUMNS.map((column) => (
                  <Text allowFontScaling={false} key={column} style={[text.label, tone.faint, styles.countCell]}>{column}</Text>
                ))}
              </View>
              {workingSetsByMuscle.map((muscle) => (
                <View
                  accessibilityLabel={muscleRowLabel(muscle)}
                  accessible
                  key={muscle.id}
                  style={[styles.tableRow, styles.bodyRow]}
                  testID={`session-completion-muscle-${muscle.id}`}>
                  <Text allowFontScaling={false} style={[text.bodyStrong, styles.nameCell]}>{muscle.displayName}</Text>
                  <RoleCount count={muscle.primarySetCount} />
                  <RoleCount count={muscle.secondarySetCount} />
                  <Text allowFontScaling={false} style={[text.figure, styles.countCell]}>
                    {formatWorkingSetCount(muscle.weightedSetCount)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text allowFontScaling={false} style={[text.body, tone.muted]} testID="session-completion-muscle-empty-state">
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
  const styles = useStyles();
  const text = useUiText();
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);
  return (
    <>
      {personalRecords.length > 0 ? (
        <View style={styles.section} testID="session-completion-personal-records">
          <Text allowFontScaling={false} accessibilityRole="header" style={text.title}>
            Personal records
          </Text>
          {personalRecords.map((personalRecord) => (
            <PersonalRecordCard
              key={personalRecord.exerciseDefinitionId}
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

const useStyles = makeStyles((roles) => ({
  section: {
    gap: uiSpace.sm,
  },
  muscles: {
    marginHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
    gap: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: roles.ruleSoft,
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
    borderTopColor: roles.ruleSoft,
  },
  nameCell: {
    flex: 1,
  },
  countCell: {
    width: uiGeometry.metricValueWidth,
    textAlign: 'right',
  },
}));
