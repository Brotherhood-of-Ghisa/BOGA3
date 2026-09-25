import { type ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SessionFactsCard } from '@/components/session-detail';
import { SessionTopBar } from '@/components/session-view';
import { ActionButton } from '@/components/ui/action-button';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type {
  CurrentSessionMuscleSummary,
  ExercisePersonalRecord,
  ExerciseVolumeComparison,
} from '@/src/session-insights';

import { SessionInsightPresentation } from '@/components/session-recorder/session-insight-presentation';
import { PersonalRecordCard } from './personal-record-card';
import { SessionShareSheet } from './session-share-sheet';

// The exercise catalogue's load state, which the muscle breakdown depends on.
export type MuscleCatalogState = 'loading' | 'ready' | 'error';

type SessionCompletionScreenProps = {
  completedAt: string;
  durationDisplay: string;
  exerciseCount: number;
  gymName: string | null;
  performedSetCount: number;
  workingSetCount: number;
  personalRecords: ExercisePersonalRecord[];
  exerciseVolumeComparisons: ExerciseVolumeComparison[];
  muscleVolumeComparisons?: ExerciseVolumeComparison[];
  header?: ReactNode;
  onEdit?: () => void;
  onViewSets?: () => void;
  muscleSummary: CurrentSessionMuscleSummary | null;
  muscleCatalogState: MuscleCatalogState;
  shouldFailNextShare?: boolean;
  onDone: () => void;
};

const formatCount = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

/**
 * The completion screen after Finish, in the design language: `Session
 * complete` · Done (where Finish sat), the summary card with working sets by
 * muscle, every new 1RM record, each exercise's volume against its history,
 * and `Share session`. Stored context only; history is optional enrichment.
 */
export function SessionCompletionScreen({
  completedAt,
  durationDisplay,
  exerciseCount,
  gymName,
  performedSetCount,
  workingSetCount,
  personalRecords,
  exerciseVolumeComparisons,
  muscleVolumeComparisons = [],
  header,
  onEdit,
  onViewSets,
  muscleSummary,
  muscleCatalogState,
  shouldFailNextShare = false,
  onDone,
}: SessionCompletionScreenProps) {
  const [isSharePreviewOpen, setIsSharePreviewOpen] = useState(false);
  const workingSetsByMuscle = muscleSummary?.workingSetsByMuscle ?? [];

  return (
    <View style={styles.screen}>
      {header ?? <SessionTopBar mode="complete" onDone={onDone} />}
      <ScrollView contentContainerStyle={styles.content} testID="session-completion-presentation">
        <SessionFactsCard
          facts={[
            [
              { label: 'Duration', value: durationDisplay, testID: 'session-completion-duration' },
              { label: 'Exercises', value: String(exerciseCount), testID: 'session-completion-exercises' },
              { label: 'Sets', value: String(performedSetCount), testID: 'session-completion-sets' },
              {
                label: 'Working',
                value: String(workingSetCount),
                align: 'end',
                testID: 'session-completion-working-sets',
              },
            ],
            [
              {
                label: 'Gym',
                value: gymName?.trim() || 'No gym',
                kind: 'text',
                testID: 'session-completion-gym',
              },
            ],
          ]}
          testID="session-completion-context">
          {performedSetCount > 0 ? (
            <View style={styles.muscles} testID="session-completion-muscle-breakdown">
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
        </SessionFactsCard>

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
          testIdPrefix="session-completion"
        />

        <ActionButton
          accessibilityHint="Opens a preview of the complete session image."
          label="Share session"
          onPress={() => setIsSharePreviewOpen(true)}
          testID="session-completion-share-session"
          variant="outline"
        />
        {onViewSets ? <ActionButton label="View individual sets" onPress={onViewSets} testID="session-summary-view-sets" variant="outline" /> : null}
        {onEdit ? <ActionButton label="Edit session" onPress={onEdit} testID="session-summary-edit" variant="primary" /> : null}
      </ScrollView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  content: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  section: {
    gap: uiSpace.sm,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: uiSpace.md,
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
