import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useConnectedAgentNames } from '@/components/more/use-connected-agent-names';
import {
  Card,
  Icon,
  ListRow,
  ScreenScroll,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import { MORE_GROUPS, type MoreDestination } from '@/src/navigation/more-destinations';
import { getAgentConnectUrl } from '@/src/utils/agent-connect';

// Like the other tabs, More has no title: two untitled cards of destinations.
export default function MoreScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const agentNames = useConnectedAgentNames(user?.id ?? null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Connect an AI leaves the app for the setup instructions only when there is
  // no agent to show: signed out, or signed in with none connected.
  const connectsExternally = !user || agentNames?.length === 0;

  const openDestination = async (destination: MoreDestination) => {
    if (destination.action.type === 'route') {
      router.push(destination.action.href);
      return;
    }
    if (!connectsExternally) {
      router.push('/connected-agents');
      return;
    }

    setConnectError(null);
    try {
      await Linking.openURL(getAgentConnectUrl());
    } catch {
      setConnectError('Couldn’t open the setup page. Try again.');
    }
  };

  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      testID="more-screen">
      {MORE_GROUPS.map((destinations, groupIndex) => (
        <Card key={groupIndex} testID={`more-group-${groupIndex + 1}`}>
          {destinations.map((destination, index) => {
            const isConnect = destination.action.type === 'connect-ai';
            const external = isConnect && connectsExternally;
            const description = isConnect && agentNames?.length ? agentNames.join(', ') : undefined;
            return (
              <View key={destination.key}>
                <ListRow
                  accessibilityLabel={description ? `${destination.label}, ${description}` : destination.label}
                  accessibilityRole={external ? 'link' : 'button'}
                  density="list"
                  description={description}
                  divider={index > 0}
                  label={destination.label}
                  leading={<Icon color={uiRoles.inkMuted} name={destination.icon} />}
                  onPress={() => {
                    void openDestination(destination);
                  }}
                  testID={destination.testID}
                  trailing={
                    <Icon
                      color={uiRoles.inkFaint}
                      name={external ? 'arrow-up-right' : 'chevron-right'}
                      size="sm"
                    />
                  }
                />
                {isConnect && connectError ? (
                  <Text
                    allowFontScaling={false}
                    accessibilityLiveRegion="polite"
                    style={styles.inlineError}
                    testID="more-connect-ai-error">
                    {connectError}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </Card>
      ))}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.xl,
  },
  // Under the row it belongs to, inset to the row's text.
  inlineError: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.danger,
  },
});
