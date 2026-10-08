import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard, SessionFactsCard } from '@/components/session-detail';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { GroupRole } from '@/src/groups';
import {
  buildSessionRecordBands,
  buildSessionRecordRows,
  sessionSetPlaces,
  shownSessionRecords,
} from '@/src/groups/competition-session-records-view-model';
import { buildCompetitionSession } from '@/src/groups/competition-session-view-model';
import type { CompetitionSessionRecordWire, CompetitionSessionWire } from '@/src/groups/competition-wire';
import {
  formatGroupDateTime,
  formatSessionStatusLabel,
} from '@/src/groups';

import { GroupSessionRecordsCard } from './group-session-records-card';

const IN_PROGRESS_LABEL = 'In progress';

const formatSetCount = (count: number): string => `${count} ${count === 1 ? 'set' : 'sets'}`;

/**
 * The group session body, in the design language and on the cards View
 * Session uses (`components/session-detail/`): the session's status and facts,
 * the Group records card, then one card per exercise with its performed sets
 * as `type · weight × reps · 1RM · VOL` and a `#1 in group` band on the set
 * that took a group record. Who and when are the screen title's. Read-only for
 * the session — no edit, delete or append; certification is the records
 * card's. Performed sets only: the server returns every live set raw, and the
 * device selects the performed ones (contract).
 */
export type FriendSessionRecordsProps = {
  records: readonly CompetitionSessionRecordWire[];
  groupId: string;
  userId: string;
  myRole: GroupRole | null;
  online: boolean | null;
  onRecordsChanged: () => Promise<void>;
};

export function FriendSessionContent({ session, records, groupId, userId, myRole, online, onRecordsChanged }:
  { session: CompetitionSessionWire } & FriendSessionRecordsProps) {
  const model = useMemo(() => buildCompetitionSession(session),[session]);
  const { rows, bands } = useMemo(() => {
    const shown = shownSessionRecords(session, records);
    const places = sessionSetPlaces(model.cards);
    return { rows: buildSessionRecordRows({ records: shown, places, groupId, userId }), bands: buildSessionRecordBands(shown, places) };
  }, [session, records, model.cards, groupId, userId]);

  const isActive = session.status === 'active';

  return (
    <>
      <SessionFactsCard
        facts={[
          { label: 'Gym', value: session.gym_name?.trim() || 'No gym', kind: 'text', testID: 'group-session-gym' },
          { label: 'Ex', spokenLabel: 'Exercises', value: String(model.exerciseCount), testID: 'group-session-exercises' },
          { label: 'Sets', value: String(model.setCount), testID: 'group-session-sets' },
          { label: 'Volume', value: model.volume, align: 'end', testID: 'group-session-volume' },
        ]}
        header={
          <View style={styles.header} testID="group-session-header">
            <View style={styles.status}>
              {/* A ring marks "current" in the design language (§5). */}
              {isActive ? <Icon color={uiRoles.accent} name="set-current" size="xs" /> : null}
              <Text allowFontScaling={false} style={styles.statusText} testID="group-session-status">
                {isActive ? IN_PROGRESS_LABEL : session.status === 'draft' ? 'Draft' : formatSessionStatusLabel({ ...session,status: session.status })}
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
      <GroupSessionRecordsCard groupId={groupId} myRole={myRole} onChanged={onRecordsChanged} online={online} rows={rows} userId={userId} />
      {model.cards.length === 0 ? (
        <Text allowFontScaling={false} style={styles.empty} testID="group-session-no-sets">
          No performed sets yet.
        </Text>
      ) : (
        model.cards.map((card) => (
          <ExerciseSetsCard
            accessibilityLabel={[card.name, formatSetCount(card.rows.length), ...(bands.get(card.id) ?? []).map(line => line.spoken)].join(', ')}
            count={formatSetCount(card.rows.length)}
            key={card.id}
            name={card.name}
            record={bands.get(card.id) ?? []}
            rowTestID={(row) => `group-session-set-row-${row.id}`}
            rows={card.rows}
            hideDerivedMetrics={card.hideDerivedMetrics}
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
