import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Icon,
  ListRow,
  PageHeader,
  ScreenScroll,
  uiFonts,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';
import { useAuth } from '@/src/auth';
import {
  getMoreSections,
  type MoreDestination,
} from '@/src/navigation/more-destinations';
import { getAgentConnectUrl } from '@/src/utils/agent-connect';
import { isDevMode } from '@/src/utils/isDevMode';

export default function MoreScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [connectError, setConnectError] = useState<string | null>(null);
  const sections = getMoreSections({ hasUser: user !== null, isDeveloper: isDevMode() });

  const openDestination = async (destination: MoreDestination) => {
    if (destination.action.type === 'route') {
      router.push(destination.action.href);
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
      <PageHeader
        intro="Community, coaching tools, and library management stay close without crowding your daily training."
        title="More"
      />

      {sections.map((section) => (
        <View key={section.key} style={styles.section} testID={`more-section-${section.key}`}>
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.sectionLabel}>
            {section.title}
          </Text>
          <Card>
            {section.destinations.map((destination, index) => {
              const external = destination.action.type === 'connect-agent';
              return (
                <View key={destination.key}>
                  <ListRow
                    accessibilityHint={destination.accessibilityHint}
                    accessibilityLabel={`${destination.label}. ${destination.description}`}
                    accessibilityRole={external ? 'link' : 'button'}
                    density="list"
                    description={destination.description}
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
                  {destination.key === 'connect-agent' && connectError ? (
                    <Text
                      allowFontScaling={false}
                      accessibilityLiveRegion="polite"
                      style={styles.inlineError}
                      testID="more-connect-agent-error">
                      {connectError}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>
      ))}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  // Sections sit a step further apart than a label and its card.
  content: {
    gap: uiSpace.xl,
  },
  section: {
    gap: uiSpace.sm,
  },
  sectionLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
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
