import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiSpace } from '@/components/ui';
import type { GroupApiError } from '@/src/groups';

type GroupStateViewProps = {
  testID: string;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionTestID?: string;
  /** Extra content, e.g. the empty state's Create / Join actions (M22-T05). */
  children?: ReactNode;
};

/** A whole-area state card: signed out, empty, offline with no cache, lost access, error. */
export function GroupStateView({ testID, title, body, actionLabel, onAction, actionTestID, children }: GroupStateViewProps) {
  return (
    <UiSurface style={styles.card} testID={testID}>
      <UiText variant="title">{title}</UiText>
      {body ? <UiText variant="bodyMuted">{body}</UiText> : null}
      {actionLabel && onAction ? (
        <UiButton label={actionLabel} onPress={onAction} testID={actionTestID} variant="secondary" />
      ) : null}
      {children}
    </UiSurface>
  );
}

/** `NOT_FOUND` on a group read (C3.6.8): cached data is hidden (the hook already evicted it). */
export function GroupLostAccessState({ testID }: { testID: string }) {
  return (
    <GroupStateView
      body="Its stream and members are no longer available to you."
      testID={testID}
      title="You're no longer a member of this group"
    />
  );
}

export function GroupLoadingState({ testID }: { testID: string }) {
  return (
    <View style={styles.loading} testID={testID}>
      <ActivityIndicator color={uiColors.textSecondary} />
      <UiText variant="bodyMuted">Loading…</UiText>
    </View>
  );
}

/** A non-network failure beside data that is still shown: the message plus Retry. */
export function GroupInlineError({ error, onRetry, testID }: { error: GroupApiError; onRetry: () => void; testID: string }) {
  return (
    <View accessibilityRole="alert" style={styles.inlineError} testID={testID}>
      <UiText style={styles.inlineErrorText} variant="body">
        {error.message}
      </UiText>
      <UiButton label="Retry" onPress={onRetry} testID={`${testID}-retry`} variant="danger" />
    </View>
  );
}

export const GROUPS_EMPTY_BODY =
  "Groups let a few friends follow each other's training. Sessions you log after joining a group show up in its stream.";

/** No groups yet. `children` is the slot for the Create / Join actions (`GroupsEmptyActions`). */
export function GroupsEmptyState({ testID, children }: { testID: string; children?: ReactNode }) {
  return (
    <GroupStateView body={GROUPS_EMPTY_BODY} testID={testID} title="No groups yet">
      {children}
    </GroupStateView>
  );
}

/** The empty state's primary actions: Create group, then Join group. testIDs `<prefix>-create-button` / `-join-button`. */
export function GroupsEmptyActions({ testIDPrefix }: { testIDPrefix: string }) {
  const router = useRouter();
  return (
    <View style={styles.emptyActions}>
      <UiButton label="Create group" onPress={() => router.push('/group/new')} testID={`${testIDPrefix}-create-button`} />
      <UiButton
        label="Join with a code"
        onPress={() => router.push('/group/join')}
        testID={`${testIDPrefix}-join-button`}
        variant="secondary"
      />
    </View>
  );
}

type GroupMissingDataStateProps = {
  offline: boolean;
  error: GroupApiError | null;
  onRetry: () => void;
  testIDPrefix: string;
};

/**
 * Nothing cached to show: the offline empty state (C3.10.4), the error state
 * with Retry, or loading. testIDs: `<prefix>-offline-empty-state`,
 * `<prefix>-error-state` (+ `-retry`), `<prefix>-loading`.
 */
export function GroupMissingDataState({ offline, error, onRetry, testIDPrefix }: GroupMissingDataStateProps) {
  if (offline) {
    return (
      <GroupStateView
        body="This loads when you're back online."
        testID={`${testIDPrefix}-offline-empty-state`}
        title="You're offline"
      />
    );
  }
  if (error) {
    return (
      <GroupStateView
        actionLabel="Retry"
        actionTestID={`${testIDPrefix}-error-state-retry`}
        body={error.message}
        onAction={onRetry}
        testID={`${testIDPrefix}-error-state`}
        title="Couldn't load this"
      />
    );
  }
  return <GroupLoadingState testID={`${testIDPrefix}-loading`} />;
}

/** A failure to show: anything but `NETWORK` (the offline marker covers it) and `NOT_FOUND` (lost access). */
export const pickInlineError = (...errors: (GroupApiError | null)[]): GroupApiError | null =>
  errors.find((error) => error !== null && error.code !== 'NETWORK' && error.code !== 'NOT_FOUND') ?? null;

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.md,
  },
  emptyActions: {
    gap: uiSpace.sm,
  },
  loading: {
    alignItems: 'center',
    gap: uiSpace.sm,
    padding: uiSpace.xxl,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    padding: uiSpace.md,
    borderRadius: uiSpace.md,
    borderWidth: 1,
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  inlineErrorText: {
    flex: 1,
    color: uiColors.actionDangerText,
  },
});
