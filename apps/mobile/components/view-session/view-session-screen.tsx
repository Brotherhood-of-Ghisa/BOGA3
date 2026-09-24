import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ExerciseSetsCard, SessionFactsCard } from '@/components/session-detail';
import { Icon } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { CompletedSessionDetailModel } from '@/src/session-recorder/completed-session-detail-model';

import { ViewSessionExerciseSheet, ViewSessionOptionsSheet } from './view-session-sheets';
import { ViewSessionTopBar } from './view-session-top-bar';

export type ViewSessionSummary = {
  // `YYYY-MM-DD HH:mm`, as the completed edit's Start/End fields show them.
  start: string;
  end: string;
  duration: string;
  gymName: string | null;
  deleted: boolean;
};

type ViewSessionScreenProps = {
  summary: ViewSessionSummary;
  model: CompletedSessionDetailModel;
  // A failed write (delete, undelete, append), shown until the next action.
  error: string | null;
  onBack: () => void;
  onEdit: () => void;
  onToggleDeleted: () => void;
  onAppend: (sessionExerciseId: string) => void;
};

const formatSetCount = (count: number): string => `${count} ${count === 1 ? 'set' : 'sets'}`;

/**
 * View Session: a finished session, read-only (redesign, View Session restyle).
 * Summary card, then one card per exercise with every performed set. Editing
 * happens on the session view (`Edit`); the ⋮s hold what is rare: delete or
 * undelete the session, append an exercise to the current session.
 */
export function ViewSessionScreen({
  summary,
  model,
  error,
  onBack,
  onEdit,
  onToggleDeleted,
  onAppend,
}: ViewSessionScreenProps) {
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [exerciseSheet, setExerciseSheet] = useState<{ id: string; name: string } | null>(null);

  return (
    <View style={styles.screen}>
      <ViewSessionTopBar
        onBack={onBack}
        onEdit={summary.deleted ? undefined : onEdit}
        onOpenOptions={() => setIsOptionsVisible(true)}
      />
      <ScrollView contentContainerStyle={styles.content} testID="completed-session-detail-screen">
        {summary.deleted ? (
          <View style={styles.band} testID="completed-session-detail-deleted-band">
            <Icon color={uiRoles.inkMuted} name="trash" size="xs" />
            <Text style={styles.bandLabel}>Deleted · hidden from history</Text>
          </View>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error} testID="completed-session-detail-error-notice">
            {error}
          </Text>
        ) : null}
        <SessionFactsCard
          facts={[
            { label: 'Duration', value: summary.duration, testID: 'completed-session-detail-duration' },
            {
              label: 'Gym',
              value: summary.gymName?.trim() ? summary.gymName : 'No gym',
              kind: 'text',
              testID: 'completed-session-detail-gym',
            },
            { label: 'Sets', value: String(model.performedSetCount), testID: 'completed-session-detail-sets' },
            { label: 'Volume', value: model.volume, align: 'end', testID: 'completed-session-detail-volume' },
          ]}
          testID="completed-session-detail-summary"
          times={{ start: summary.start, end: summary.end, testID: 'completed-session-detail-times' }}
        />
        {model.cards.length === 0 ? (
          <Text style={styles.empty} testID="completed-session-detail-no-exercises">
            No exercises logged in this session.
          </Text>
        ) : (
          model.cards.map((card) => (
            <ExerciseSetsCard
              accessibilityLabel={[
                card.name,
                formatSetCount(card.setCount),
                card.recordOneRepMax ? `new 1RM record ${card.recordOneRepMax}` : null,
              ]
                .filter(Boolean)
                .join(', ')}
              control={
                <Pressable
                  accessibilityLabel={`Options for ${card.name}`}
                  accessibilityRole="button"
                  onPress={() => setExerciseSheet({ id: card.id, name: card.name })}
                  style={styles.control}
                  testID={`completed-session-detail-exercise-options-${card.id}`}>
                  <Icon color={uiRoles.inkMuted} name="more-vertical" size="sm" />
                </Pressable>
              }
              count={formatSetCount(card.setCount)}
              key={card.id}
              name={card.name}
              recordOneRepMax={card.recordOneRepMax}
              rows={card.rows}
              testID={`completed-session-detail-exercise-${card.id}`}
            />
          ))
        )}
      </ScrollView>

      <ViewSessionOptionsSheet
        deleted={summary.deleted}
        onDismiss={() => setIsOptionsVisible(false)}
        onToggleDeleted={() => {
          setIsOptionsVisible(false);
          onToggleDeleted();
        }}
        visible={isOptionsVisible}
      />
      <ViewSessionExerciseSheet
        exercise={exerciseSheet}
        onAppend={(sessionExerciseId) => {
          setExerciseSheet(null);
          onAppend(sessionExerciseId);
        }}
        onDismiss={() => setExerciseSheet(null)}
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
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: uiRoles.surfaceSubtle,
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
  control: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
