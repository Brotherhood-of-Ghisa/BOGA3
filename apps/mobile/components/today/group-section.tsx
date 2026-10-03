import { StyleSheet, View } from 'react-native';

import { GroupInlineError, GroupMissingDataState, GroupOfflineBanner, pickInlineError } from '@/components/groups';
import { Card } from '@/components/ui/card';
import { StatePanel } from '@/components/ui/state-panel';
import { uiSpace } from '@/components/ui/tokens';

import { TodayGroupCard } from './group-card';
import type { TodayGroupState } from './use-today-group';

type Available = Extract<TodayGroupState, { status: 'available' }>;

export type TodayGroupSectionProps = {
  state: TodayGroupState;
  nowMs: number;
  onSignIn: () => void;
  onFindGroup: () => void;
  onOpenGroup: (groupId: string) => void;
  onOpenSession: (memberUserId: string, sessionId: string) => void;
};

function AccountPanel({ state, onSignIn }: { state: Exclude<TodayGroupState, Available>; onSignIn: () => void }) {
  if (state.status === 'auth-unavailable') {
    return (
      <Card>
        <StatePanel
          body="Groups need an account, and sign-in is not available in this build."
          fill={false}
          testID="today-group-auth-unavailable"
          title="Group activity needs an account"
        />
      </Card>
    );
  }
  return (
    <Card>
      <StatePanel
        action={{ label: 'Sign in', onPress: onSignIn, testID: 'today-group-sign-in' }}
        body="Sign in to see activity from groups you've joined."
        fill={false}
        testID="today-group-signed-out"
        title="Group activity needs an account"
      />
    </Card>
  );
}

function AvailableContent({ state, nowMs, onFindGroup, onOpenGroup, onOpenSession }: Omit<TodayGroupSectionProps, 'state' | 'onSignIn'> & { state: Available }) {
  const retry = () => {
    void state.refresh();
  };
  if (state.groups !== null && state.groups.length === 0) {
    return (
      <Card>
        <StatePanel
          action={{ label: 'Find a group', onPress: onFindGroup, testID: 'today-group-find-group' }}
          body="Join or create a group to see who's leading the week and who's training now."
          fill={false}
          testID="today-group-empty"
          title="Train with friends"
        />
      </Card>
    );
  }
  if (state.groups === null || state.selectedGroupId === null || state.summary === null) {
    return <GroupMissingDataState error={state.error} offline={state.offline} onRetry={retry} testIDPrefix="today-group" />;
  }
  return (
    <TodayGroupCard
      groups={state.groups}
      myUserId={state.myUserId}
      nowMs={nowMs}
      onOpenGroup={onOpenGroup}
      onOpenSession={onOpenSession}
      onSelectGroup={state.selectGroup}
      selectedGroupId={state.selectedGroupId}
      summary={state.summary}
    />
  );
}

/**
 * The Group activity section's body: the account panels, then (signed in)
 * the offline marker and an inline error above the cached card, the no-group
 * panel, or the missing-data states while nothing is cached.
 */
export function TodayGroupSection({ state, onSignIn, ...rest }: TodayGroupSectionProps) {
  if (state.status !== 'available') {
    return <AccountPanel onSignIn={onSignIn} state={state} />;
  }
  const inlineError = pickInlineError(state.error);
  const hasCard = state.summary !== null;
  return (
    <View style={styles.list}>
      {state.offline ? <GroupOfflineBanner lastUpdatedAtMs={state.lastUpdatedAtMs} /> : null}
      {inlineError && hasCard ? (
        <GroupInlineError error={inlineError} onRetry={() => void state.refresh()} testID="today-group-inline-error" />
      ) : null}
      <AvailableContent state={state} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: uiSpace.sm,
  },
});
