import { type ReactNode, useState } from 'react';
import { Text, View } from 'react-native';

import { ExerciseSetsCard, SessionFactsCard } from '@/components/session-detail';
import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Screen, ScreenScroll } from '@/components/ui/screen';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';
import type { CompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';

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
}: ViewSessionScreenProps) {
  const styles = useStyles();
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
          <View style={styles.band} testID="completed-session-detail-deleted-band">
            <Icon colorRole="inkMuted" name="trash" size="xs" />
            <Text allowFontScaling={false} style={text.label}>Deleted · hidden from history</Text>
          </View>
        ) : null}
        {error ? (
          <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={[text.bodyStrong, tone.danger]} testID="completed-session-detail-error-notice">
            {error}
          </Text>
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
        <SegmentedControl
          accessibilityLabel="Session review section"
          options={[{ value: 'summary', label: 'Summary' }, { value: 'sets', label: 'Sets' }]}
          value={section}
          onChange={onSectionChange}
          testIDPrefix="view-session-section"
        />
        {section === 'summary' ? summaryContent : model.cards.length === 0 ? (
          <Text allowFontScaling={false} style={[text.body, tone.muted]} testID="completed-session-detail-no-exercises">
            No exercises logged in this session.
          </Text>
        ) : (
          model.cards.map((card) => (
            <ExerciseSetsCard
              accessibilityLabel={[
                card.name,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: roles.paper,
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    borderRadius: uiGeometry.radius.card,
  },
}));
