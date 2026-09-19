import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiSurface, UiText, uiBorder, uiColors, uiRadius, uiSpace, uiTypography } from '@/components/ui';
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
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      testID="more-screen">
      <View style={styles.intro}>
        <UiText accessibilityRole="header" selectable style={styles.screenTitle} variant="title">
          More
        </UiText>
        <UiText selectable variant="bodyMuted">
          Community, coaching tools, and library management stay close without crowding your daily training.
        </UiText>
      </View>

      {sections.map((section) => (
        <View key={section.key} style={styles.section} testID={`more-section-${section.key}`}>
          <UiText accessibilityRole="header" selectable variant="title">
            {section.title}
          </UiText>
          <View style={styles.destinationList}>
            {section.destinations.map((destination) => {
              const external = destination.action.type === 'connect-agent';
              return (
                <View key={destination.key} style={styles.destinationItem}>
                  <Pressable
                    accessibilityHint={destination.accessibilityHint}
                    accessibilityLabel={`${destination.label}. ${destination.description}`}
                    accessibilityRole={external ? 'link' : 'button'}
                    onPress={() => {
                      void openDestination(destination);
                    }}
                    style={({ pressed }) => [
                      styles.destinationPressable,
                      pressed ? styles.destinationPressed : null,
                    ]}
                    testID={destination.testID}>
                    <UiSurface style={styles.destinationCard}>
                      <View style={styles.iconBadge}>
                        <UiText selectable={false} style={styles.iconGlyph} variant="labelStrong">
                          {destination.glyph}
                        </UiText>
                      </View>
                      <View style={styles.destinationCopy}>
                        <UiText selectable variant="labelStrong">
                          {destination.label}
                        </UiText>
                        <UiText selectable variant="bodyMuted">
                          {destination.description}
                        </UiText>
                      </View>
                      <UiText
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        selectable={false}
                        style={styles.destinationIndicator}
                        variant="labelStrong">
                        {external ? '↗' : '›'}
                      </UiText>
                    </UiSurface>
                  </Pressable>
                  {destination.key === 'connect-agent' && connectError ? (
                    <UiText
                      accessibilityLiveRegion="polite"
                      selectable
                      style={styles.inlineError}
                      testID="more-connect-agent-error"
                      variant="bodyMuted">
                      {connectError}
                    </UiText>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
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
    paddingBottom: uiSpace.screen,
    gap: uiSpace.xxl,
  },
  intro: {
    gap: uiSpace.sm,
  },
  screenTitle: {
    fontSize: uiTypography.size.xxl,
    lineHeight: 30,
  },
  section: {
    gap: uiSpace.md,
  },
  destinationList: {
    gap: uiSpace.sm,
  },
  destinationItem: {
    gap: uiSpace.sm,
  },
  destinationPressable: {
    width: '100%',
  },
  destinationPressed: {
    opacity: 0.92,
  },
  destinationCard: {
    minHeight: 76,
    paddingHorizontal: uiSpace.xxl,
    paddingVertical: uiSpace.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.lg,
  },
  iconBadge: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.surfaceInfo,
  },
  iconGlyph: {
    fontSize: 15,
    lineHeight: 18,
    color: uiColors.actionPrimary,
  },
  destinationCopy: {
    flex: 1,
    gap: uiSpace.xs,
  },
  destinationIndicator: {
    fontSize: 22,
    lineHeight: 24,
    color: uiColors.textSecondary,
  },
  inlineError: {
    color: uiColors.actionDangerText,
    paddingHorizontal: uiSpace.sm,
  },
});
