import { StyleSheet, View } from 'react-native';

import { GroupInlineError, GroupMissingDataState, GroupOfflineBanner, pickInlineError } from '@/components/groups';
import { uiSpace } from '@/components/ui/tokens';

import { TodayGroupCard } from './group-card';
import { TodayPanel } from './today-panel';
import type { TodayGroupState } from './use-today-group';

type Available = Extract<TodayGroupState, { status: 'available' }>;

export type TodayGroupSectionProps = {
  state: TodayGroupState;
  nowMs: number;
  onSignIn: () => void;
  onFindGroup: () => void;
  onOpenGroup: (groupId: string) => void;
  onOpenSession: (memberUserId: string, sessionId: string, groupId: string) => void;
  /** The cards layout: the page is the card, so panels fill it and nothing draws its own. */
  fill?: boolean;
};

function AccountPanel({ state, onSignIn, fill }: { state: Exclude<TodayGroupState, Available>; onSignIn: () => void; fill: boolean }) {
  if (state.status === 'auth-unavailable') {
    return (
      <TodayPanel
        body="Groups need an account, and sign-in is not available in this build."
        fill={fill}
        testID="today-group-auth-unavailable"
        title="Group activity needs an account"
      />
    );
  }
  return (
    <TodayPanel
      action={{ label: 'Sign in', onPress: onSignIn, testID: 'today-group-sign-in' }}
      body="Sign in to see activity from groups you've joined."
      fill={fill}
      testID="today-group-signed-out"
      title="Group activity needs an account"
    />
  );
}

function AvailableContent({ state, nowMs, onFindGroup, onOpenGroup, onOpenSession, fill = false }: Omit<TodayGroupSectionProps, 'state' | 'onSignIn'> & { state: Available }) {
  const retry = () => {
    void state.refresh();
  };
  if (state.groups !== null && state.groups.length === 0) {
    return (
      <TodayPanel
        action={{ label: 'Find a group', onPress: onFindGroup, testID: 'today-group-find-group' }}
        body="Join or create a group to see who's leading the week and who's training now."
        fill={fill}
        testID="today-group-empty"
        title="Train with friends"
      />
    );
  }
  if (state.groups === null || state.selectedGroupId === null || state.summary === null) {
    const missing = <GroupMissingDataState error={state.error} offline={state.offline} onRetry={retry} testIDPrefix="today-group" />;
    // The shared state draws at its content's height; in a card, centre it.
    return fill ? (
      <View style={styles.centred} testID="today-group-missing">
        {missing}
      </View>
    ) : (
      missing
    );
  }
  return (
    <TodayGroupCard
      fill={fill}
      myUserId={state.myUserId}
      nowMs={nowMs}
      onOpenGroup={onOpenGroup}
      onOpenSession={onOpenSession}
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
export function TodayGroupSection({ state, onSignIn, fill = false, ...rest }: TodayGroupSectionProps) {
  if (state.status !== 'available') {
    return <AccountPanel fill={fill} onSignIn={onSignIn} state={state} />;
  }
  const inlineError = pickInlineError(state.error);
  const hasCard = state.summary !== null;
  return (
    <View style={[styles.list, fill ? styles.fill : null]}>
      {state.offline ? (
        <View style={fill ? styles.inset : null}>
          <GroupOfflineBanner lastUpdatedAtMs={state.lastUpdatedAtMs} />
        </View>
      ) : null}
      {inlineError && hasCard ? (
        <View style={fill ? styles.inset : null}>
          <GroupInlineError error={inlineError} onRetry={() => void state.refresh()} testID="today-group-inline-error" />
        </View>
      ) : null}
      <AvailableContent fill={fill} state={state} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: uiSpace.sm,
  },
  fill: {
    flex: 1,
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
  },
  // In the cards layout a notice sits inside the page's card, so takes an inset.
  inset: {
    paddingHorizontal: uiSpace.sm,
    paddingTop: uiSpace.sm,
  },
});
