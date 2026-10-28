import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  FigureText,
  ListRow,
  ScreenScroll,
  StatePanel,
  SwitchRow,
  Tag,
  uiSpace,
  uiText,
  uiTextTone,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  listConnectedAgents,
  revokeConnectedAgent,
  setAgentPlanPermission,
  type ConnectedAgent,
} from '@/src/auth/connected-agents';

const formatTimestamp = (value: string | null, dateFormat: ExerciseDateFormat): string => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return formatLocalDateTime(date.getTime(), dateFormat);
};

type ConnectedAgentCardProps = {
  agent: ConnectedAgent;
  onRevoke: (agent: ConnectedAgent) => void;
  onTogglePlanAccess: (agent: ConnectedAgent, next: boolean) => void;
  revokeDisabled: boolean;
  revoking: boolean;
  saving: boolean;
};

function ConnectedAgentCard({
  agent,
  onRevoke,
  onTogglePlanAccess,
  revokeDisabled,
  revoking,
  saving,
}: ConnectedAgentCardProps) {
  const dateFormat = useDateFormat();
  const isUnavailable = agent.planAccessEnabled === 'unavailable';
  const isSwitchDisabled = saving || isUnavailable;
  const switchValue = agent.planAccessEnabled === true;

  return (
    <Card testID={`connected-agent-${agent.clientId}`}>
      <View style={styles.agentHeader}>
        <View style={styles.agentTitle}>
          <Text allowFontScaling={false} style={uiText.title}>{agent.name}</Text>
          <Text allowFontScaling={false} style={uiText.meta}>Read training data</Text>
        </View>
        <Tag label="AI" />
      </View>
      <ListRow
        density="list"
        meta={
          <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink]} testID={`connected-agent-granted-${agent.clientId}`}>
            <FigureText>{formatTimestamp(agent.grantedAt, dateFormat)}</FigureText>
          </Text>
        }>
        <Text allowFontScaling={false} style={uiText.body}>Access granted</Text>
      </ListRow>
      <ListRow
        density="list"
        meta={
          <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink]} testID={`connected-agent-last-access-${agent.clientId}`}>
            <FigureText>{formatTimestamp(agent.lastAccessAt, dateFormat)}</FigureText>
          </Text>
        }>
        <Text allowFontScaling={false} style={uiText.body}>Last access</Text>
      </ListRow>
      {/* A separate, opt-in authorization: the base OAuth grant stays read-only. */}
      <View style={styles.permission}>
        <SwitchRow
          disabled={isSwitchDisabled}
          label="Allow this coach to make changes"
          onValueChange={(value) => {
            onTogglePlanAccess(agent, value);
          }}
          testID={`connected-agent-plan-access-${agent.clientId}`}
          value={switchValue}
        />
        {isUnavailable ? (
          <Text
            allowFontScaling={false}
            style={[uiText.meta, uiTextTone.danger, styles.permissionUnavailable]}
            testID={`connected-agent-plan-unavailable-${agent.clientId}`}>
            Change settings are temporarily unavailable for this coach.
          </Text>
        ) : null}
        <Text
          allowFontScaling={false}
          style={[uiText.meta, styles.permissionDisclosure]}
          testID={`connected-agent-plan-disclosure-${agent.clientId}`}>
          {`Lets ${agent.name} read your upcoming and unscheduled plans, create new plans and programmes, and add, edit, delete or restore exercises and their muscles. Exercise changes also recalculate your past figures. It can never edit or delete plans, start a workout, or change your logged sets.`}
        </Text>
      </View>
      {/* An outline in `danger`, behind the unchanged Alert confirm. */}
      <View style={styles.agentActions}>
        <ActionButton
          accessibilityLabel={`Revoke access for ${agent.name}`}
          disabled={revokeDisabled}
          label={revoking ? 'Revoking…' : 'Revoke access'}
          onPress={() => onRevoke(agent)}
          testID={`connected-agent-revoke-${agent.clientId}`}
          tone="danger"
          variant="outline"
        />
      </View>
    </Card>
  );
}

export default function ConnectedAgentsScreen() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<ConnectedAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);
  const [savingClientIds, setSavingClientIds] = useState<ReadonlySet<string>>(new Set());

  // Fetches and applies the agents; the caller has already shown loading.
  const fetchAgents = () =>
    listConnectedAgents()
      .then(setAgents, (loadError: unknown) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load connected agents right now.',
        );
      })
      .finally(() => {
        setIsLoading(false);
      });

  const loadAgents = () => {
    setIsLoading(true);
    setError(null);
    return fetchAgents();
  };

  // A session change reloads this data boundary through its user ID: shown
  // in the render that sees it, fetched by the effect below.
  const userId = user?.id ?? null;
  const [shownUserId, setShownUserId] = useState<string | null | undefined>(undefined);
  if (shownUserId !== userId) {
    setShownUserId(userId);
    if (userId) {
      setIsLoading(true);
    } else {
      setAgents([]);
    }
    setError(null);
  }

  useEffect(() => {
    if (!userId) return;
    void fetchAgents();
  }, [userId]);

  const revoke = async (agent: ConnectedAgent) => {
    setRevokingClientId(agent.clientId);
    setError(null);
    try {
      await revokeConnectedAgent(agent.clientId);
      setAgents((current) =>
        current.filter((candidate) => candidate.clientId !== agent.clientId)
      );
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : 'Unable to revoke this agent right now.',
      );
    } finally {
      setRevokingClientId(null);
    }
  };

  const confirmRevoke = (agent: ConnectedAgent) => {
    Alert.alert(
      `Revoke ${agent.name}?`,
      'The agent will immediately lose access to your BoGa training data. You can reconnect it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke access',
          style: 'destructive',
          onPress: () => {
            void revoke(agent);
          },
        },
      ],
    );
  };

  // Optimistic only because a failed write reverts to the server value and
  // surfaces a retryable error. Plan access stays off until the server agrees.
  // Writes are serialized per client ID so concurrent toggles across distinct
  // coaches settle independently without clobbering each other.
  const togglePlanAccess = async (agent: ConnectedAgent, next: boolean) => {
    if (savingClientIds.has(agent.clientId)) return;
    setSavingClientIds((current) => new Set([...current, agent.clientId]));
    setError(null);
    setAgents((current) =>
      current.map((candidate) =>
        candidate.clientId === agent.clientId
          ? { ...candidate, planAccessEnabled: next }
          : candidate
      )
    );
    try {
      await setAgentPlanPermission(agent.clientId, next, agent.grantedAt);
    } catch (toggleError) {
      setAgents((current) =>
        current.map((candidate) =>
          candidate.clientId === agent.clientId
            ? { ...candidate, planAccessEnabled: agent.planAccessEnabled }
            : candidate
        )
      );
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : 'Unable to update access for this coach right now.',
      );
    } finally {
      setSavingClientIds((current) => {
        const nextSet = new Set(current);
        nextSet.delete(agent.clientId);
        return nextSet;
      });
    }
  };

  // The native header carries the title (G4).
  return (
    <ScreenScroll contentInsetAdjustmentBehavior="automatic" testID="connected-agents-screen">
      {!user ? (
        <Card>
          <StatePanel
            body="Sign in to review and revoke connected agents."
            fill={false}
            testID="connected-agents-signed-out"
            title="Sign in required"
          />
        </Card>
      ) : null}

      {user && isLoading && agents.length === 0 ? (
        <Card>
          <StatePanel
            body="Loading connected agents…"
            fill={false}
            kind="loading"
            testID="connected-agents-loading"
          />
        </Card>
      ) : null}

      {user && !isLoading && agents.length === 0 && !error ? (
        <Card>
          <StatePanel
            body="Connections you authorize will appear here."
            fill={false}
            testID="connected-agents-empty"
            title="No agents connected"
          />
        </Card>
      ) : null}

      {agents.map((agent) => (
        <ConnectedAgentCard
          agent={agent}
          key={agent.clientId}
          onRevoke={confirmRevoke}
          onTogglePlanAccess={togglePlanAccess}
          revokeDisabled={revokingClientId !== null}
          revoking={revokingClientId === agent.clientId}
          saving={savingClientIds.has(agent.clientId)}
        />
      ))}

      {error ? (
        <Card>
          <StatePanel body={error} fill={false} kind="error" testID="connected-agents-error">
            <ActionButton
              accessibilityLabel="Retry loading connected agents"
              disabled={isLoading}
              label={isLoading ? 'Retrying…' : 'Retry'}
              onPress={() => {
                void loadAgents();
              }}
              variant="outline"
            />
          </StatePanel>
        </Card>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.md,
    paddingHorizontal: uiSpace.lg,
    paddingTop: uiSpace.md,
    paddingBottom: uiSpace.sm,
  },
  agentTitle: {
    flex: 1,
    gap: uiSpace.xs,
  },
  permission: {
    paddingBottom: uiSpace.sm,
  },
  permissionUnavailable: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.xs,
  },
  permissionDisclosure: {
    paddingHorizontal: uiSpace.lg,
  },
  agentActions: {
    padding: uiSpace.lg,
    paddingTop: uiSpace.sm,
  },
});
