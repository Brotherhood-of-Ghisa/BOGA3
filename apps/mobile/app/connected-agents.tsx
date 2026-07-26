import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import {
  UiButton,
  UiSurface,
  UiText,
  uiBorder,
  uiColors,
  uiRadius,
  uiSpace,
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

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      testID="connected-agents-screen">
      <View style={styles.intro}>
        <UiText selectable variant="title">
          Connected agents
        </UiText>
        <UiText selectable variant="bodyMuted">
          Agents can read training data only. They cannot create, edit, or delete exercises,
          workouts, or sets.
        </UiText>
      </View>

      {!user ? (
        <UiSurface style={styles.card} testID="connected-agents-signed-out">
          <UiText selectable variant="labelStrong">
            Sign in required
          </UiText>
          <UiText selectable variant="bodyMuted">
            Sign in to review and revoke connected agents.
          </UiText>
        </UiSurface>
      ) : null}

      {user && isLoading && agents.length === 0 ? (
        <UiSurface style={styles.card} testID="connected-agents-loading">
          <UiText selectable variant="bodyMuted">
            Loading connected agents…
          </UiText>
        </UiSurface>
      ) : null}

      {user && !isLoading && agents.length === 0 && !error ? (
        <UiSurface style={styles.card} testID="connected-agents-empty">
          <UiText selectable variant="labelStrong">
            No agents connected
          </UiText>
          <UiText selectable variant="bodyMuted">
            Connections you authorize will appear here.
          </UiText>
        </UiSurface>
      ) : null}

      {agents.map((agent) => (
        <UiSurface
          key={agent.clientId}
          style={styles.agentCard}
          testID={`connected-agent-${agent.clientId}`}>
          <View style={styles.agentHeader}>
            <View style={styles.agentBadge}>
              <UiText selectable={false} variant="labelStrong">
                AI
              </UiText>
            </View>
            <View style={styles.agentTitle}>
              <UiText selectable variant="labelStrong">
                {agent.name}
              </UiText>
              <UiText selectable variant="bodyMuted">
                Read training data
              </UiText>
            </View>
          </View>
          <View style={styles.metadata}>
            <View style={styles.metadataRow}>
              <UiText selectable variant="bodyMuted">Access granted</UiText>
              <UiText selectable testID={`connected-agent-granted-${agent.clientId}`}>
                {formatTimestamp(agent.grantedAt)}
              </UiText>
            </View>
            <View style={styles.metadataRow}>
              <UiText selectable variant="bodyMuted">Last access</UiText>
              <UiText selectable testID={`connected-agent-last-access-${agent.clientId}`}>
                {formatTimestamp(agent.lastAccessAt)}
              </UiText>
            </View>
          </View>
          <UiButton
            accessibilityLabel={`Revoke access for ${agent.name}`}
            disabled={revokingClientId !== null}
            label={revokingClientId === agent.clientId ? 'Revoking…' : 'Revoke access'}
            onPress={() => confirmRevoke(agent)}
            testID={`connected-agent-revoke-${agent.clientId}`}
            variant="danger"
          />
        </UiSurface>
      ))}

      {error ? (
        <UiSurface style={styles.errorCard} testID="connected-agents-error">
          <UiText selectable style={styles.errorText} variant="bodyMuted">
            {error}
          </UiText>
          <UiButton
            accessibilityLabel="Retry loading connected agents"
            disabled={isLoading}
            label={isLoading ? 'Retrying…' : 'Retry'}
            onPress={() => {
              void loadAgents();
            }}
            variant="secondary"
          />
        </UiSurface>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.screen,
    gap: uiSpace.lg,
  },
  intro: {
    gap: uiSpace.sm,
    marginBottom: uiSpace.sm,
  },
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.sm,
  },
  agentCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.lg,
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.lg,
  },
  agentBadge: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.actionPrimarySubtleBg,
  },
  agentTitle: {
    flex: 1,
    gap: uiSpace.xxs,
  },
  metadata: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiColors.borderMuted,
    paddingTop: uiSpace.md,
    gap: uiSpace.sm,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: uiSpace.md,
  },
  errorCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.md,
    borderColor: uiColors.actionDangerSubtleBorder,
    backgroundColor: uiColors.actionDangerSubtleBg,
  },
  errorText: {
    color: uiColors.actionDangerText,
  },
});
