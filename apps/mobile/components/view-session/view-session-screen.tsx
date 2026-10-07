import { type ReactNode, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard, SessionFactsCard } from '@/components/session-detail';
import { Icon } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Screen, ScreenScroll } from '@/components/ui/screen';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { CompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';

import { ViewSessionOptionsSheet } from './view-session-sheets';
import { ViewSessionTopBar } from './view-session-top-bar';

export type ViewSessionSummary = {
  // `Afternoon training · 19 Feb` (`completedSessionTitle`).
  title: string;
  // `YYYY-MM-DD HH:mm`, as the completed edit's Start field shows it.
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
  // A failed write (delete, undelete, append), shown until the next action.
  error: string | null;
  onBack: () => void;
  onEdit: () => void;
  onToggleDeleted: () => void;
};

const formatSetCount = (count: number): string => `${count} ${count === 1 ? 'set' : 'sets'}`;

/**
 * View Session: a finished session, read-only (redesign, View Session restyle).
 * Facts, then local Summary / Sets sections. Editing happens on the session
 * view (`Edit`); the ⋮ holds what is rare: delete or undelete the session.
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
}: ViewSessionScreenProps) {
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);

  return (
    <Screen>
      <ViewSessionTopBar
        onBack={onBack}
        onEdit={summary.deleted ? undefined : onEdit}
        onOpenOptions={() => setIsOptionsVisible(true)}
        title={summary.title}
      />
      <ScreenScroll keyboardShouldPersistTaps="handled" testID="completed-session-detail-screen">
        {summary.deleted ? (
          <View style={styles.band} testID="completed-session-detail-deleted-band">
            <Icon color={uiRoles.inkMuted} name="trash" size="xs" />
            <Text allowFontScaling={false} style={styles.bandLabel}>Deleted · hidden from history</Text>
          </View>
        ) : null}
        {error ? (
          <Text allowFontScaling={false} accessibilityLiveRegion="polite" style={styles.error} testID="completed-session-detail-error-notice">
            {error}
          </Text>
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
            { label: model.volumeNote && model.volume !== '—' ? 'Known vol' : 'Volume', value: model.volume, align: 'end', testID: 'completed-session-detail-volume' },
          ]}
          note={model.volumeNote}
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
          <Text allowFontScaling={false} style={styles.empty} testID="completed-session-detail-no-exercises">
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

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: uiRoles.paper,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.card,
  },
  bandLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  error: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
  empty: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
