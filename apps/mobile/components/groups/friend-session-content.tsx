import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ExerciseCardCollapsedSummary,
  SessionContentLayout,
} from '@/components/session-recorder/session-content-layout';
import { UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';
import { formatSessionSetType, isWorkingSessionSetType, normalizeSessionSetType } from '@/src/data/set-types';
import {
  formatGroupDateTime,
  formatKg,
  formatMemberName,
  formatSessionStatusLabel,
  selectGroupPerformedExercises,
  type GroupSessionDetail,
} from '@/src/groups';

type FriendSet = { id: string; weightLabel: string; reps: number; effortLabel: string; working: boolean };
type FriendExercise = { id: string; name: string; machineName: string | null; sets: FriendSet[] };

/** View Session's effort column wording. */
export const formatGroupSetEffort = (setType: string | null): string =>
  formatSessionSetType(setType) ?? '-';

const IN_PROGRESS_LABEL = 'In progress';

/**
 * The friend's session body (C3.8): the View Session layout
 * (`SessionContentLayout`) with read-only rows and NO owner actions — no
 * edit, delete, or append. Performed sets only: the server returns every live
 * set raw, and the device selects the performed ones (contract §5).
 */
export function FriendSessionContent({ session }: { session: GroupSessionDetail }) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const toggleCollapsed = useCallback((exerciseId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (!next.delete(exerciseId)) next.add(exerciseId);
      return next;
    });
  }, []);

  const exercises = useMemo<FriendExercise[]>(
    () =>
      selectGroupPerformedExercises(session.exercises).map((exercise) => ({
        id: exercise.sessionExerciseId,
        name: exercise.name,
        machineName: exercise.machineName,
        sets: exercise.sets.map((set) => ({
          id: set.setId,
          weightLabel: `${formatKg(set.weightKg)} kg`,
          reps: set.reps,
          effortLabel: formatGroupSetEffort(set.setType),
          working: isWorkingSessionSetType(normalizeSessionSetType(set.setType)),
        })),
      })),
    [session],
  );

  const isActive = session.status === 'active';
  const metrics = [
    { label: 'Start', value: formatGroupDateTime(session.started_at_ms) },
    { label: 'End', value: session.completed_at_ms === null ? '—' : formatGroupDateTime(session.completed_at_ms) },
    { label: 'Location', value: session.gym_name?.trim() || 'No gym' },
  ];

  return (
    <>
      <UiSurface style={styles.headerCard} testID="group-session-header">
        <View style={styles.headerRow}>
          <UiText numberOfLines={1} style={styles.flex} testID="group-session-member" variant="title">
            {formatMemberName(session.member.username)}
          </UiText>
          <UiText style={isActive ? styles.liveText : null} testID="group-session-status" variant="subtitle">
            {isActive ? IN_PROGRESS_LABEL : formatSessionStatusLabel(session)}
          </UiText>
        </View>
        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCell}>
              <UiText variant="subtitle">{metric.label}</UiText>
              <UiText numberOfLines={1} variant="labelStrong">
                {metric.value}
              </UiText>
            </View>
          ))}
        </View>
      </UiSurface>

      <SessionContentLayout<FriendSet, FriendExercise>
        collapsedExerciseIds={collapsedIds}
        dateTimeValue={null}
        emptyExercisesText="No performed sets yet."
        exercises={exercises}
        gymValue={null}
        onToggleExerciseCollapse={toggleCollapsed}
        renderCollapsedExerciseSummary={({ exercise }) => (
          <ExerciseCardCollapsedSummary
            setCount={exercise.sets.length}
            testID={`group-session-collapsed-summary-${exercise.id}`}
            workingSetCount={exercise.sets.filter((set) => set.working).length}
          />
        )}
        renderSetHeader={() => (
          <View style={[styles.setRow, styles.setHeaderRow]}>
            {['Set', 'Weight', 'Reps', 'Effort'].map((label, index) => (
              <UiText key={label} style={[styles.headerCell, CELL_STYLES[index]]} variant="subtitle">
                {label}
              </UiText>
            ))}
          </View>
        )}
        renderSetRow={({ set, setIndex }) => (
          <View style={styles.setRow} testID={`group-session-set-row-${set.id}`}>
            {[`${setIndex + 1}`, set.weightLabel, `${set.reps}`, set.effortLabel].map((value, index) => (
              <UiText key={index} numberOfLines={1} style={CELL_STYLES[index]} variant="label">
                {value}
              </UiText>
            ))}
          </View>
        )}
        showMetadataSection={false}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  liveText: {
    color: uiColors.textSuccess,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: uiSpace.md,
  },
  metricCell: {
    width: '46%',
    gap: uiSpace.xs,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.sm,
    paddingVertical: uiSpace.xs,
  },
  setHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: uiColors.borderMuted,
  },
  headerCell: {
    textTransform: 'uppercase',
  },
  indexCell: {
    width: 36,
  },
  valueCell: {
    flex: 1,
  },
  effortCell: {
    width: 56,
  },
});

const CELL_STYLES = [styles.indexCell, styles.valueCell, styles.valueCell, styles.effortCell];
