import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import {
  GroupInlineError,
  GroupLoadingState,
  GroupOfflineBanner,
  GroupStateView,
  GroupsSignInRequired,
  GroupWriteNotice,
  pickInlineError,
  usePullToRefresh,
} from '@/components/groups';
import {
  ActionButton,
  Card,
  ListRow,
  Notice,
  Screen,
  ScreenScroll,
  SearchField,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
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
 * exercises, or unlink it. Opened from the catalogue ⋮ and the exercise page's ⋮
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

type LinkNotice = { tone: 'success' | 'error'; text: string };

function ExerciseLinkContent({ userId }: { userId: string }) {
  const params = useLocalSearchParams<{ exerciseDefinitionId?: string | string[] }>();
  const exerciseDefinitionId = coerceParam(params.exerciseDefinitionId);
  const catalog = useExerciseCatalog();
  const linking = useGroupExerciseLinking({ userId });
  const { pulling, onRefresh } = usePullToRefresh(linking.refresh);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<LinkNotice | null>(null);
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
      <Screen style={styles.stateScreen}>
        <Stack.Screen options={{ title }} />
        <GroupStateView
          body={catalog.lastError ?? 'Try again in a moment.'}
          testID="exercise-link-catalog-error"
          title="Couldn't load your exercises"
        />
      </Screen>
    );
  }

  if (!exerciseDefinitionId || (!catalogLoading && !exercise)) {
    return (
      <Screen style={styles.stateScreen}>
        <Stack.Screen options={{ title }} />
        <GroupStateView
          body="Open this screen from an exercise's menu."
          testID="exercise-link-missing-state"
          title="This exercise isn't available"
        />
      </Screen>
    );
  }

  if (!exercise || !model) {
    return (
      <Screen style={styles.stateScreen}>
        <Stack.Screen options={{ title }} />
        <GroupLoadingState testID="exercise-link-loading" />
      </Screen>
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
    <ScreenScroll
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={pulling} />}
      testID="exercise-link-screen">
      <Stack.Screen options={{ title }} />
      {linking.offline ? <GroupOfflineBanner lastUpdatedAtMs={linking.lastUpdatedAtMs} /> : null}
      {notice ? <GroupWriteNotice message={notice.text} testID="exercise-link-notice" tone={notice.tone} /> : null}
      {loaded && inlineError ? (
        <GroupInlineError error={inlineError} onRetry={onRefresh} testID="exercise-link-inline-error" />
      ) : null}

      {linking.linksError ? (
        <Notice
          action={
            <ActionButton
              accessibilityLabel="Retry reading links"
              label="Retry"
              onPress={() => void linking.reloadLinks()}
              testID="exercise-link-links-retry"
              variant="outline"
            />
          }
          live
          message={linking.linksError}
          testID="exercise-link-links-error"
          tone="danger"
        />
      ) : !linking.linksReady ? <GroupLoadingState testID="exercise-link-links-loading" /> : null}
      {linking.linksReady && model.linked.length > 0 ? (
        <Section title="Linked">
          <Card>
            {model.linked.map((row, index) => (
              <ListRow
                density="list"
                divider={index > 0}
                key={row.key}
                meta={
                  <ActionButton
                    accessibilityLabel={`Unlink from ${row.groupExerciseName} in ${row.groupName}`}
                    disabled={mutationPending}
                    label={unlink.pending ? 'Unlinking…' : 'Unlink'}
                    onPress={() => confirmUnlink(row)}
                    testID={`exercise-link-unlink-${row.groupExerciseId}`}
                    tone="danger"
                    variant="text"
                  />
                }
                testID={`exercise-link-linked-row-${row.groupExerciseId}`}>
                <RowText
                  groupName={row.groupName}
                  lines={[row.statusLabel, row.loadModeNote]}
                  name={row.groupExerciseName}
                />
              </ListRow>
            ))}
          </Card>
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
          <SearchField
            accessibilityLabel="Search group exercises"
            autoCapitalize="none"
            onChangeText={setQuery}
            placeholder="Search group exercises…"
            testID="exercise-link-search"
            value={query}
          />
          {model.suggested.length > 0 ? (
            <Section title="Suggested">
              <Card>
                {model.suggested.map((row, index) => (
                  <AvailableRow divider={index > 0} key={row.key} onLink={link} pendingKey={mutationPending || !linking.linksReady ? 'pending' : null} row={row} showGroup />
                ))}
              </Card>
            </Section>
          ) : null}
          {model.groups.length > 0 ? (
            <Section title="All group exercises">
              {model.groups.map((group) => (
                <View key={group.groupId} style={styles.group}>
                  <Text allowFontScaling={false} style={styles.groupName}>{group.groupName}</Text>
                  <Card>
                    {group.rows.map((row, index) => (
                      <AvailableRow divider={index > 0} key={row.key} onLink={link} pendingKey={mutationPending || !linking.linksReady ? 'pending' : null} row={row} />
                    ))}
                  </Card>
                </View>
              ))}
            </Section>
          ) : null}
          {offeredCount === 0 ? (
            <Text allowFontScaling={false} style={styles.muted} testID="exercise-link-empty">
              {(linking.catalogs?.length ?? 0) === 0
                ? "You're not in any groups yet."
                : query.trim().length > 0
                  ? 'No group exercises match.'
                  : 'No group exercises to link.'}
            </Text>
          ) : null}
        </>
      )}
    </ScreenScroll>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A row's words: the name (· group), then any status lines in `ink-muted`. */
function RowText({ name, groupName, lines }: { name: string; groupName?: string; lines: (string | null | undefined)[] }) {
  return (
    <View style={styles.rowText}>
      <Text allowFontScaling={false} style={styles.name}>
        {name}
        {groupName ? <Text allowFontScaling={false} style={styles.nameGroup}> · {groupName}</Text> : null}
      </Text>
      {lines.filter(Boolean).map((line) => (
        <Text allowFontScaling={false} key={line} style={styles.muted}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function AvailableRow({
  row,
  pendingKey,
  onLink,
  showGroup = false,
  divider,
}: {
  row: LinkScreenAvailableRow;
  pendingKey: string | null;
  onLink: (row: LinkScreenAvailableRow) => Promise<void>;
  showGroup?: boolean;
  divider: boolean;
}) {
  const name = row.groupExercise.name;
  return (
    <ListRow
      density="list"
      divider={divider}
      meta={
        row.unavailableReason ? undefined : (
          <ActionButton
            accessibilityLabel={`Link to ${name} in ${row.groupName}`}
            disabled={pendingKey !== null}
            label="Link"
            onPress={() => void onLink(row)}
            testID={`exercise-link-link-${row.groupExercise.group_exercise_id}`}
            variant="outline"
          />
        )
      }
      testID={`exercise-link-row-${row.groupExercise.group_exercise_id}`}>
      <RowText
        groupName={showGroup ? row.groupName : undefined}
        lines={[row.unavailableReason ?? row.loadModeNote]}
        name={name}
      />
    </ListRow>
  );
}

const styles = StyleSheet.create({
  // A whole-screen state sits in the page gutter.
  stateScreen: {
    padding: uiSpace.lg,
  },
  section: {
    gap: uiSpace.sm,
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
  },
  group: {
    gap: uiSpace.xs,
  },
  groupName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  rowText: {
    paddingVertical: uiSpace.sm,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  nameGroup: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    color: uiRoles.inkMuted,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
