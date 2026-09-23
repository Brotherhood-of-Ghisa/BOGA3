import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  GroupInlineError,
  GroupLoadingState,
  GroupOfflineBanner,
  GroupStateView,
  GroupsSignInRequired,
  groupFormStyles,
  groupScreenStyles,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import { UiButton, UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';
import { useAuth } from '@/src/auth';
import { linkExercise } from '@/src/data/exercise-group-links';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import {
  buildLinkScreenModel,
  describeLinkRetroactivity,
  groupExercisesLoaded,
  type LinkScreenAvailableRow,
  type LinkScreenLinkedRow,
  type LinkableExercise,
} from '@/src/groups';
import { useExerciseUnlink } from '@/src/groups/use-exercise-unlink';
import { useGroupExerciseLinking } from '@/src/groups/use-group-exercise-linking';

const coerceParam = (value: string | string[] | undefined): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Link screen (M25-T07; product E0.3): link one of my exercises to my groups'
 * exercises, or unlink it. Opened from the catalogue ⋮ and recorder •••
 * menus. Link and Unlink are local writes to the synced
 * `exercise_group_links`, so they work offline; group-exercise names come from
 * `group_cache` (design §7).
 */
export default function ExerciseLinkRoute() {
  const { isConfigured, user } = useAuth();
  if (!isConfigured || !user) {
    return <GroupsSignInRequired isConfigured={isConfigured} />;
  }
  return <ExerciseLinkContent userId={user.id} />;
}

type Notice = { tone: 'success' | 'error'; text: string };

function ExerciseLinkContent({ userId }: { userId: string }) {
  const params = useLocalSearchParams<{ exerciseDefinitionId?: string | string[] }>();
  const exerciseDefinitionId = coerceParam(params.exerciseDefinitionId);
  const catalog = useExerciseCatalog();
  const linking = useGroupExerciseLinking({ userId });
  const { pulling, onRefresh } = usePullToRefresh(linking.refresh);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const unlink = useExerciseUnlink({
    offline: linking.offline, reloadLinks: linking.reloadLinks,
    onNotice: (next) => setNotice(next ? { tone: next.tone, text: next.message } : null),
  });
  const mutationPending = pendingKey !== null || unlink.pending;

  const exercise: LinkableExercise | null = useMemo(
    () => catalog.exercises.find((candidate) => candidate.id === exerciseDefinitionId) ?? null,
    [catalog.exercises, exerciseDefinitionId],
  );
  const model = useMemo(
    () =>
      exercise ? buildLinkScreenModel({ exercise, catalogs: linking.catalogs, linkedCatalogs: linking.linkedCatalogs, links: linking.links, query }) : null,
    [exercise, linking.catalogs, linking.linkedCatalogs, linking.links, query],
  );

  const catalogLoading = catalog.status === 'idle' || catalog.status === 'loading';
  const title = exercise ? `Link "${exercise.name}"` : 'Link exercise';
  // The offline marker already covers NETWORK (as on every group screen).
  const inlineError = pickInlineError(linking.error);
  const loaded = groupExercisesLoaded(linking.catalogs);

  if (catalog.status === 'error') {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title }} />
        <GroupStateView
          body={catalog.lastError ?? 'Try again in a moment.'}
          testID="exercise-link-catalog-error"
          title="Couldn't load your exercises"
        />
      </View>
    );
  }

  if (!exerciseDefinitionId || (!catalogLoading && !exercise)) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title }} />
        <GroupStateView
          body="Open this screen from an exercise's menu."
          testID="exercise-link-missing-state"
          title="This exercise isn't available"
        />
      </View>
    );
  }

  if (!exercise || !model) {
    return (
      <View style={[groupScreenStyles.screen, groupScreenStyles.content]}>
        <Stack.Screen options={{ title }} />
        <GroupLoadingState testID="exercise-link-loading" />
      </View>
    );
  }

  const link = async (row: LinkScreenAvailableRow) => {
    setPendingKey(row.key);
    setNotice(null);
    try {
      await linkExercise(exercise.id, row.groupId, row.groupExercise.group_exercise_id);
      await linking.reloadLinks();
      setNotice({ tone: 'success', text: describeLinkRetroactivity(exercise.name, row.groupName) });
    } catch (caught) {
      setNotice({ tone: 'error', text: caught instanceof Error ? caught.message : "Couldn't link this exercise." });
    } finally {
      setPendingKey(null);
    }
  };

  const confirmUnlink = (row: LinkScreenLinkedRow) => {
    if (mutationPending || !linking.linksReady) return;
    unlink.confirmUnlink({
      personalExerciseId: exercise.id, personalExerciseName: exercise.name,
      groupId: row.groupId, groupName: row.groupName,
      groupExerciseId: row.groupExerciseId, groupExerciseName: row.groupExerciseName,
      archived: row.archived, inactive: row.inactive,
    });
  };

  const offeredCount = model.suggested.length + model.groups.reduce((total, group) => total + group.rows.length, 0);

  return (
    <ScrollView
      contentContainerStyle={groupScreenStyles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      style={groupScreenStyles.screen}
      testID="exercise-link-screen">
      <Stack.Screen options={{ title }} />
      {linking.offline ? <GroupOfflineBanner lastUpdatedAtMs={linking.lastUpdatedAtMs} /> : null}
      {notice ? (
        <UiText
          accessibilityLiveRegion="polite"
          accessibilityRole={notice.tone === 'error' ? 'alert' : undefined}
          style={notice.tone === 'error' ? styles.errorText : styles.successText}
          testID="exercise-link-notice">
          {notice.text}
        </UiText>
      ) : null}
      {loaded && inlineError ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="exercise-link-inline-error" />
      ) : null}

      {linking.linksError ? (
        <View style={styles.section}>
          <UiText accessibilityRole="alert" style={styles.errorText} testID="exercise-link-links-error">{linking.linksError}</UiText>
          <UiButton label="Retry reading links" onPress={() => void linking.reloadLinks()} style={styles.unlinkButton} testID="exercise-link-links-retry" variant="secondary" />
        </View>
      ) : !linking.linksReady ? <GroupLoadingState testID="exercise-link-links-loading" /> : null}
      {linking.linksReady && model.linked.length > 0 ? (
        <Section title="Linked">
          {model.linked.map((row) => (
            <UiSurface key={row.key} style={styles.row} testID={`exercise-link-linked-row-${row.groupExerciseId}`}>
              <View style={styles.rowText}>
                <UiText>
                  {row.groupExerciseName}
                  <UiText variant="bodyMuted"> · {row.groupName}</UiText>
                </UiText>
                {row.statusLabel ? <UiText variant="bodyMuted">{row.statusLabel}</UiText> : null}
                {row.loadModeNote ? <UiText variant="bodyMuted">{row.loadModeNote}</UiText> : null}
              </View>
              <UiButton
                accessibilityLabel={`Unlink from ${row.groupExerciseName} in ${row.groupName}`}
                disabled={mutationPending}
                label={unlink.pending ? 'Unlinking…' : 'Unlink'}
                style={styles.unlinkButton}
                onPress={() => confirmUnlink(row)}
                testID={`exercise-link-unlink-${row.groupExerciseId}`}
                variant="danger"
              />
            </UiSurface>
          ))}
        </Section>
      ) : null}

      {!model.canLink ? (
        <GroupStateView
          body="Deleted exercises can't be linked. Restore it from the Exercise Catalog first."
          testID="exercise-link-deleted-state"
          title="Restore this exercise to link it"
        />
      ) : !loaded ? (
        linking.offline ? (
          <GroupStateView
            body="Your links are saved on this device; group exercises appear once you're online."
            testID="exercise-link-offline-empty-state"
            title="Connect once to load your groups' exercises"
          />
        ) : inlineError ? (
          <GroupInlineError error={inlineError} onRetry={onRefresh} testID="exercise-link-error-state" />
        ) : (
          <GroupLoadingState testID="exercise-link-loading-groups" />
        )
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search group exercises"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search group exercises…"
            style={groupFormStyles.input}
            testID="exercise-link-search"
            value={query}
          />
          {model.suggested.length > 0 ? (
            <Section title="Suggested">
              {model.suggested.map((row) => (
                <AvailableRow key={row.key} onLink={link} pendingKey={mutationPending || !linking.linksReady ? 'pending' : null} row={row} showGroup />
              ))}
            </Section>
          ) : null}
          {model.groups.length > 0 ? (
            <Section title="All group exercises">
              {model.groups.map((group) => (
                <View key={group.groupId} style={styles.group}>
                  <UiText variant="label">{group.groupName}</UiText>
                  {group.rows.map((row) => (
                    <AvailableRow key={row.key} onLink={link} pendingKey={mutationPending || !linking.linksReady ? 'pending' : null} row={row} />
                  ))}
                </View>
              ))}
            </Section>
          ) : null}
          {offeredCount === 0 ? (
            <UiText testID="exercise-link-empty" variant="bodyMuted">
              {(linking.catalogs?.length ?? 0) === 0
                ? "You're not in any groups yet."
                : query.trim().length > 0
                  ? 'No group exercises match.'
                  : 'No group exercises to link.'}
            </UiText>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <UiText accessibilityRole="header" style={styles.sectionHeader} variant="label">
        {title}
      </UiText>
      {children}
    </View>
  );
}

function AvailableRow({
  row,
  pendingKey,
  onLink,
  showGroup = false,
}: {
  row: LinkScreenAvailableRow;
  pendingKey: string | null;
  onLink: (row: LinkScreenAvailableRow) => Promise<void>;
  showGroup?: boolean;
}) {
  const name = row.groupExercise.name;
  return (
    <UiSurface style={styles.row} testID={`exercise-link-row-${row.groupExercise.group_exercise_id}`}>
      <View style={styles.rowText}>
        <UiText>
          {name}
          {showGroup ? <UiText variant="bodyMuted"> · {row.groupName}</UiText> : null}
        </UiText>
        {row.unavailableReason ? <UiText variant="bodyMuted">{row.unavailableReason}</UiText> : null}
        {!row.unavailableReason && row.loadModeNote ? <UiText variant="bodyMuted">{row.loadModeNote}</UiText> : null}
      </View>
      {row.unavailableReason ? null : (
        <UiButton
          accessibilityLabel={`Link to ${name} in ${row.groupName}`}
          disabled={pendingKey !== null}
          label="Link"
          onPress={() => void onLink(row)}
          testID={`exercise-link-link-${row.groupExercise.group_exercise_id}`}
          variant="secondary"
        />
      )}
    </UiSurface>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
  },
  sectionHeader: {
    color: uiColors.textSecondary,
  },
  group: {
    gap: uiSpace.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.md,
  },
  unlinkButton: { minHeight: 44 },
  rowText: {
    flex: 1,
    gap: uiSpace.xs,
  },
  successText: {
    color: uiColors.textSuccess,
  },
  errorText: {
    color: uiColors.actionDangerText,
  },
});
