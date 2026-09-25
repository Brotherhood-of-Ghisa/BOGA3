import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  ListRow,
  ScreenScroll,
  StatePanel,
  Tag,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  listConnectedAgents,
  revokeConnectedAgent,
  type ConnectedAgent,
} from '@/src/auth/connected-agents';

const formatTimestamp = (value: string | null): string => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

export default function ConnectedAgentsScreen() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<ConnectedAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);

  const loadAgents = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setAgents(await listConnectedAgents());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load connected agents right now.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setAgents([]);
      setError(null);
      return;
    }
    void loadAgents();
    // A session change remounts this data boundary through its user ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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

  // The native header carries the title (G4, T05-D1); the intro stays.
  return (
    <ScreenScroll contentInsetAdjustmentBehavior="automatic" testID="connected-agents-screen">
      <Text style={styles.intro}>
        Agents can read training data only. They cannot create, edit, or delete exercises,
        workouts, or sets.
      </Text>

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
        <Card key={agent.clientId} testID={`connected-agent-${agent.clientId}`}>
          <View style={styles.agentHeader}>
            <View style={styles.agentTitle}>
              <Text style={styles.agentName}>{agent.name}</Text>
              <Text style={styles.agentScope}>Read training data</Text>
            </View>
            <Tag label="AI" />
          </View>
          <ListRow
            density="list"
            meta={
              <Text style={styles.date} testID={`connected-agent-granted-${agent.clientId}`}>
                {formatTimestamp(agent.grantedAt)}
              </Text>
            }>
            <Text style={styles.rowLabel}>Access granted</Text>
          </ListRow>
          <ListRow
            density="list"
            meta={
              <Text style={styles.date} testID={`connected-agent-last-access-${agent.clientId}`}>
                {formatTimestamp(agent.lastAccessAt)}
              </Text>
            }>
            <Text style={styles.rowLabel}>Last access</Text>
          </ListRow>
          {/* An outline in `danger`, behind the unchanged Alert confirm. */}
          <View style={styles.agentActions}>
            <ActionButton
              accessibilityLabel={`Revoke access for ${agent.name}`}
              disabled={revokingClientId !== null}
              label={revokingClientId === agent.clientId ? 'Revoking…' : 'Revoke access'}
              onPress={() => confirmRevoke(agent)}
              testID={`connected-agent-revoke-${agent.clientId}`}
              tone="danger"
              variant="outline"
            />
          </View>
        </Card>
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
  intro: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
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
  agentName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  agentScope: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
  rowLabel: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  date: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
  agentActions: {
    padding: uiSpace.lg,
    paddingTop: uiSpace.sm,
  },
});
