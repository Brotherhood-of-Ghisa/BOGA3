import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard, SessionFactsCard } from '@/components/session-detail';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { SessionBodyWeight } from '@/components/bodyweight/session-body-weight';
import { sessionVolumeSummary } from '@/src/exercise-calculations/analytics';
import { computeGroupSessionMetrics, groupSessionWeightSnapshot } from '@/src/groups/session-metrics';
import {
  formatGroupDateTime,
  formatMemberName,
  formatSessionStatusLabel,
  selectGroupPerformedExercises,
  type GroupSessionDetail,
} from '@/src/groups';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

const IN_PROGRESS_LABEL = 'In progress';

const formatSetCount = (count: number): string => `${count} ${count === 1 ? 'set' : 'sets'}`;

/**
 * The friend's session body (C3.8), in the design language and on the cards
 * View Session uses (`components/session-detail/`): the member, the session's
 * facts, then one card per exercise with its performed sets as `type · weight
 * × reps · 1RM · VOL`. Read-only — NO owner actions (no edit, delete, append)
 * and no record band, since the friend's history is not on this device.
 * Performed sets only: the server returns every live set raw, and the device
 * selects the performed ones (contract §5).
 */
export function FriendSessionContent({ session }: { session: GroupSessionDetail }) {
  const model = useMemo(() => {
    const metrics = computeGroupSessionMetrics(session.exercises, session);
    const cards = selectGroupPerformedExercises(session.exercises, session).map(exercise => ({
      id: exercise.sessionExerciseId,
      name: exercise.name,
      rows: exercise.sets.map(set => formatSetRow({ id: set.setId, weight: set.enteredWeight,
        reps: set.reps, setType: set.setType, done: true, loadContext: exercise.loadContext,
        weightUnit: set.weightUnit, externalLoadMode: set.externalLoadMode })),
    }));
    const summary = sessionVolumeSummary(metrics.coverage);
    const basis = metrics.basis === 'personal'
      ? 'Personal metrics · this member’s exercise settings and saved session weight.'
      : 'Original entered-load metrics · bodyweight context is unavailable in this older result.';
    return { cards, setCount: metrics.performedSets, volume: summary.volume,
      note: [basis, summary.volumeNote].filter(Boolean).join(' ') };
  }, [session]);

  const isActive = session.status === 'active';

  return (
    <>
      <SessionFactsCard
        note={model.note}
        facts={[
          { label: 'Gym', value: session.gym_name?.trim() || 'No gym', kind: 'text', testID: 'group-session-gym' },
          { label: 'Sets', value: String(model.setCount), testID: 'group-session-sets' },
          { label: 'Volume', value: model.volume, align: 'end', testID: 'group-session-volume' },
        ]}
        header={
          <View style={styles.header} testID="group-session-header">
            <Text allowFontScaling={false} numberOfLines={1} style={styles.member} testID="group-session-member">
              {formatMemberName(session.member.username)}
            </Text>
            <View style={styles.status}>
              {/* A ring marks "current" in the design language (§5). */}
              {isActive ? <Icon color={uiRoles.accent} name="set-current" size="xs" /> : null}
              <Text allowFontScaling={false} style={styles.statusText} testID="group-session-status">
                {isActive ? IN_PROGRESS_LABEL : formatSessionStatusLabel(session)}
              </Text>
            </View>
          </View>
        }
        testID="group-session-summary"
        times={{
          start: formatGroupDateTime(session.started_at_ms),
          end: session.completed_at_ms === null ? '—' : formatGroupDateTime(session.completed_at_ms),
          testID: 'group-session-times',
        }}
      />
      {session.metric_revision === 'dated_added_load_v3' ? (
        <SessionBodyWeight editable={false} sessionId={session.session_id}
          snapshot={groupSessionWeightSnapshot(session)} onSaved={() => {}} />
      ) : null}
      {model.cards.length === 0 ? (
        <Text allowFontScaling={false} style={styles.empty} testID="group-session-no-sets">
          No performed sets yet.
        </Text>
      ) : (
        model.cards.map((card) => (
          <ExerciseSetsCard
            accessibilityLabel={`${card.name}, ${formatSetCount(card.rows.length)}`}
            count={formatSetCount(card.rows.length)}
            key={card.id}
            name={card.name}
            recordOneRepMax={null}
            rowTestID={(row) => `group-session-set-row-${row.id}`}
            rows={card.rows}
            testID={`group-session-exercise-${card.id}`}
          />
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: uiSpace.md,
    paddingTop: uiSpace.md,
    gap: uiSpace.xs,
  },
  member: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  statusText: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  empty: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
