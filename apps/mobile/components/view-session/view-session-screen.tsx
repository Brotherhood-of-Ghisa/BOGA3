import { type ReactNode, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { ExerciseSetsCard, SessionFactsCard } from '@/components/session-detail';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-section';
import { Icon } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Screen, ScreenScroll } from '@/components/ui/screen';
import { Tag } from '@/components/ui/tag';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiSpace } from '@/components/ui/tokens';
import { useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';
import { useSessionChallengeExercises } from '@/src/groups/use-session-meets';
import type { CompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';

import { SessionMeetRows } from './session-meet-rows';
import { ViewSessionOptionsSheet } from './view-session-sheets';
import { ViewSessionTopBar } from './view-session-top-bar';

export type ViewSessionSummary = {
  // `Afternoon training` with its local date (`completedSessionTitle`).
  title: string;
  // The selected date format plus `HH:mm`, as the completed edit's Start field shows it.
  start: string;
  duration: string;
  gymName: string | null;
  deleted: boolean;
};

export type ViewSessionSection = 'summary' | 'sets';

// The finished session a meet row and `Challenge` tags are read for.
export type ViewSessionMeetSession = { sessionId: string; startedAt: Date; completedAt: Date };

type ViewSessionScreenProps = {
  section: ViewSessionSection;
  onSectionChange: (section: ViewSessionSection) => void;
  summaryContent: ReactNode;
  summary: ViewSessionSummary;
  model: CompletedSessionDetailModel;
  // A failed write (delete, undelete), shown until the next action.
  error: string | null;
  onBack: () => void;
  onEdit: () => void;
  onToggleDeleted: () => void;
  onResume?: () => void;
  onOpenActive?: () => void;
  busy?: boolean;
  isResuming?: boolean;
  // Absent for a session that cannot join meets (deleted, or not loaded).
  meetSession?: ViewSessionMeetSession;
};

const formatSetCount = (count: number): string => `${count} ${count === 1 ? 'set' : 'sets'}`;

/**
 * View Session: a finished session, read-only (redesign, View Session restyle).
 * Facts, then local Summary / Sets sections. Editing happens on the session
 * view (`Edit`); the ⋮ can resume a live completed session on Train, or delete/undelete it.
 */
export function ViewSessionScreen({
  summary,
  section,
  onSectionChange,
  summaryContent,
  model,
  error,
  onBack,
  onEdit,
  onToggleDeleted,
  onResume,
  onOpenActive,
  busy = false,
  isResuming = false,
  meetSession,
}: ViewSessionScreenProps) {
  const styles = useStyles();
  const userId = useGroupLinkingUserId();
  const definitionIds = useMemo(
    () => [...new Set(model.cards.flatMap((card) => (card.exerciseDefinitionId ? [card.exerciseDefinitionId] : [])))],
    [model.cards]
  );
  const challenged = useSessionChallengeExercises(userId, meetSession?.sessionId ?? null, definitionIds);
  const text = useUiText();
  const tone = useUiTextTone();
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);

  return (
    <Screen>
      <ViewSessionTopBar
        busy={busy}
        onBack={onBack}
        onEdit={summary.deleted ? undefined : onEdit}
        onOpenOptions={() => setIsOptionsVisible(true)}
        title={summary.title}
      />
      <ScreenScroll keyboardShouldPersistTaps="handled" testID="completed-session-detail-screen">
        {summary.deleted ? (
          <Card style={styles.band} testID="completed-session-detail-deleted-band">
            <View style={styles.bandRow}>
              <Icon colorRole="inkMuted" name="trash" size="xs" />
              <Text allowFontScaling={false} style={text.label}>Deleted · hidden from history</Text>
            </View>
          </Card>
        ) : null}
        {error ? (
          <FormError message={error} testID="completed-session-detail-error-notice" textRole="bodyStrong" />
        ) : null}
        {error && onOpenActive ? (
          <ActionButton label="Open current session" onPress={onOpenActive} testID="completed-session-detail-open-active" variant="link" />
        ) : null}
        <SessionFactsCard
          facts={[
            {
              label: 'Gym',
              value: summary.gymName?.trim() ? summary.gymName : 'No gym',
              kind: 'text',
              testID: 'completed-session-detail-gym',
            },
            { label: 'Ex', spokenLabel: 'Exercises', value: String(model.cards.length), testID: 'completed-session-detail-exercises' },
            { label: 'Sets', value: String(model.workingSetCount), testID: 'completed-session-detail-sets' },
            { label: 'Volume', value: model.volume, align: 'end', testID: 'completed-session-detail-volume' },
          ]}
          testID="completed-session-detail-summary"
          times={{ start: summary.start, duration: summary.duration, testID: 'completed-session-detail-times' }}
        />
        {meetSession ? (
          <SessionMeetRows
            sessionId={meetSession.sessionId}
            times={{ status: 'completed', startedAt: meetSession.startedAt, completedAt: meetSession.completedAt }}
          />
        ) : null}
        <SegmentedControl
          accessibilityLabel="Session review section"
          options={[{ value: 'summary', label: 'Summary' }, { value: 'sets', label: 'Sets' }]}
          value={section}
          onChange={onSectionChange}
          testIDPrefix="view-session-section"
        />
        {section === 'summary' ? summaryContent : model.cards.length === 0 ? (
          <Text allowFontScaling={false} style={[text.body, tone.pageMuted]} testID="completed-session-detail-no-exercises">
            No exercises logged in this session.
          </Text>
        ) : (
          model.cards.map((card) => (
            <ExerciseSetsCard
              accessory={challenged.has(card.exerciseDefinitionId ?? '') ? (
                <Tag label="Challenge" testID={`completed-session-detail-exercise-${card.id}-challenge`} />
              ) : undefined}
              accessibilityLabel={[
                card.name,
                challenged.has(card.exerciseDefinitionId ?? '') ? 'Challenge' : null,
                formatSetCount(card.setCount),
                ...card.record.map((line) => line.spoken),
              ]
                .filter(Boolean)
                .join(', ')}
              count={formatSetCount(card.setCount)}
              key={card.id}
              name={card.name}
              record={card.record}
              rows={card.rows}
              testID={`completed-session-detail-exercise-${card.id}`}
            />
          ))
        )}
      </ScreenScroll>

      <ViewSessionOptionsSheet
        busy={busy}
        isResuming={isResuming}
        onResume={onResume ? () => {
          setIsOptionsVisible(false);
          onResume();
        } : undefined}
        deleted={summary.deleted}
        onDismiss={() => setIsOptionsVisible(false)}
        onToggleDeleted={() => {
          setIsOptionsVisible(false);
          onToggleDeleted();
        }}
        visible={isOptionsVisible}
      />
    </Screen>
  );
}

const useStyles = makeStyles((roles) => ({
  band: {
    backgroundColor: roles.paper,
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
  },
}));
